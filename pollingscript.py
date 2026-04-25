# ====
import requests
import time
import threading
import json
import logging
import os
from datetime import datetime
from collections import deque

# ========================= CONFIG =========================
# Authentication and API endpoints for the ONE Record environment
config = {
    "client_id": "onerecord-belli",
    "client_secret": "IBo2WC3x46HHg0mCM82IziudIwjHN0el",
    "idp_url": "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/auth/realms/onerecord/protocol/openid-connect/token",
    "one_record_api_url": "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/BELLI",
    "proxy_url": "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/proxy/BELLI",
    "taxon_url": "https://champ-onerecord.germanywestcentral.cloudapp.azure.com/api/TRAXON"
}

# Logistics object types we want to monitor via pub/sub
TOPICS_TO_SUBSCRIBE = [
    "https://onerecord.iata.org/ns/cargo#ULD",
    "https://onerecord.iata.org/ns/cargo#Piece",
    "https://onerecord.iata.org/ns/cargo#LogisticsEvent",
    "https://onerecord.iata.org/ns/cargo#Shipment",
    "https://onerecord.iata.org/ns/cargo#Sensor"
]

POLL_INTERVAL = 10          # Seconds between notification polls
TOKEN_REFRESH_INTERVAL = 240  # Seconds between token refreshes (4 minutes)
CLEAR_INTERVAL = 600        # Seconds between data folder cleanup (10 minutes)
# ========================================================

# Ensure output directory exists
os.makedirs("polled_data", exist_ok=True)

# Configure logging to both file and console
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[logging.FileHandler("uld_coldchain_monitor.log", encoding="utf-8"), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Global state
token = None
headers = {}
object_queue = deque()          # Queue of logistics object IDs to process
processed_ids = set()           # Avoid re-processing the same object

def get_access_token():
    """Fetch OAuth2 client credentials token and update headers."""
    global token, headers
    payload = {'grant_type': 'client_credentials', 'client_id': config["client_id"], 'client_secret': config["client_secret"]}
    try:
        r = requests.post(config["idp_url"], data=payload)
        r.raise_for_status()
        token = r.json()['access_token']
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/ld+json", "Accept": "application/ld+json"}
        logger.info("✅ Token obtained / refreshed")
        return True
    except Exception as e:
        logger.error(f"Token error: {e}")
        return False

def refresh_token_loop():
    """Background thread: periodically refresh the access token."""
    while True:
        get_access_token()
        time.sleep(TOKEN_REFRESH_INTERVAL)

def subscribe_to_topics():
    """Create subscriptions for all monitored logistics object types."""
    for topic in TOPICS_TO_SUBSCRIBE:
        subscription = {
            "@context": {"api": "https://onerecord.iata.org/ns/api#"},
            "@type": "api:Subscription",
            "api:hasSubscriber": f"{config['one_record_api_url']}/logistics-objects/DATA_HOLDER",
            "api:hasTopicType": "https://onerecord.iata.org/ns/api#LOGISTICS_OBJECT_TYPE",
            "api:includeSubscriptionEventType": [
                {"@id": "https://onerecord.iata.org/ns/api#LOGISTICS_OBJECT_CREATED"},
                {"@id": "https://onerecord.iata.org/ns/api#LOGISTICS_OBJECT_UPDATED"},
                {"@id": "https://onerecord.iata.org/ns/api#LOGISTICS_EVENT_RECEIVED"}
            ],
            "api:hasTopic": {"@type": "http://www.w3.org/2001/XMLSchema#anyURI", "@value": topic}
        }
        try:
            r = requests.post(f"{config['taxon_url']}/subscriptions", json=subscription, headers=headers)
            logger.info(f"Subscribed to {topic.split('#')[-1]} → {r.status_code}")
        except Exception as e:
            logger.error(f"Subscription failed for {topic}: {e}")

def save_notification(notif):
    """Append raw notification to persistent JSONL file."""
    with open("polled_data/notifications.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(notif, ensure_ascii=False) + "\n")

def clear_polled_data():
    """Remove old JSON files (keeps log and notifications)."""
    for filename in list(os.listdir("polled_data")):
        if filename in ["uld_coldchain_monitor.log", "notifications.jsonl"]:
            continue
        try:
            os.remove(os.path.join("polled_data", filename))
        except:
            pass
    logger.info("🧹 Polled data folder cleared (except log and notifications.jsonl)")

def fetch_server_information(object_id):
    """GET basic server info about a logistics object."""
    if not object_id.startswith("http"):
        object_id = f"{config['one_record_api_url']}/logistics-objects/{object_id}"
    try:
        r = requests.get(object_id, headers=headers)
        return r.json() if r.status_code == 200 else {"error": r.status_code}
    except Exception as e:
        return {"error": str(e)}

def fetch_full_object(object_id):
    """GET full embedded logistics object (includes all linked data)."""
    if not object_id.startswith("http"):
        object_id = f"{config['one_record_api_url']}/logistics-objects/{object_id}"
    url = f"{object_id}?embedded=true"
    try:
        r = requests.get(url, headers=headers)
        return r.json() if r.status_code == 200 else None
    except Exception as e:
        logger.error(f"Error fetching object {object_id}: {e}")
        return None

def process_one_id():
    """Process next ID from queue: fetch full object + server info for every topic."""
    if not object_queue:
        return False
    obj_id = object_queue.popleft()
    if obj_id in processed_ids:
        return False
    processed_ids.add(obj_id)
    logger.info(f"🔄 Processing ID: {obj_id} (all topics)")

    for topic_iri in TOPICS_TO_SUBSCRIBE:
        topic_name = topic_iri.split('#')[-1]
        logger.info(f"   → Topic: {topic_name}")

        full_obj = fetch_full_object(obj_id)
        server_info = fetch_server_information(obj_id)

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        friendly = obj_id.split('/')[-1]

        # Combined detailed file
        combined = {"id": obj_id, "topic": topic_name, "timestamp": timestamp, "fullObject": full_obj, "serverInformation": server_info}
        with open(f"polled_data/{timestamp}_{friendly}_{topic_name}.json", "w", encoding="utf-8") as f:
            json.dump(combined, f, ensure_ascii=False, indent=2)

        # Separate server info file
        with open(f"polled_data/{timestamp}_{friendly}_{topic_name}_SERVER_INFO.json", "w", encoding="utf-8") as f:
            json.dump(server_info, f, ensure_ascii=False, indent=2)

        logger.info(f"      ✅ Saved {topic_name} files")

    # Summary file for quick reference
    summary = {"id": obj_id, "timestamp": datetime.now().isoformat(), "topics_processed": [t.split('#')[-1] for t in TOPICS_TO_SUBSCRIBE]}
    with open(f"polled_data/{friendly}_SUMMARY.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    logger.info(f"✅ Finished all topics for ID: {obj_id}")
    return True

def poll_notifications():
    """Background thread: continuously poll the notification endpoint."""
    while True:
        try:
            r = requests.get(f"{config['proxy_url']}/notifications?limit=100", headers=headers)
            logger.info(f"Polling notifications → Status: {r.status_code}")

            if r.status_code == 200:
                data = r.json()
                logger.info(f"Received {len(data) if isinstance(data, list) else len(data.get('items', []))} notifications")

                notifs = data if isinstance(data, list) else data.get("items", [])
                for notif in notifs:
                    save_notification(notif)
                    # Extract logistics object ID (try multiple possible keys)
                    lo_id = None
                    for key in ["https://onerecord.iata.org/ns/api#hasLogisticsObject", "logisticsObject", "object", "id"]:
                        candidate = notif.get(key)
                        if isinstance(candidate, dict) and "@id" in candidate:
                            lo_id = candidate["@id"]
                            break
                        elif isinstance(candidate, str):
                            lo_id = candidate
                            break
                    if lo_id and lo_id not in processed_ids:
                        logger.info(f"   → New ID added to queue: {lo_id}")
                        object_queue.append(lo_id)
            else:
                logger.warning(f"Notifications endpoint returned {r.status_code}")
        except Exception as e:
            logger.error(f"Polling error: {e}")
        time.sleep(POLL_INTERVAL)

# ====================== START ======================
if __name__ == "__main__":
    logger.info("🚀 DIAGNOSTIC VERSION – One ID → All Topics + Separate Server Info + Summary")

    if not get_access_token():
        logger.error("Failed to get initial token. Exiting.")
        exit(1)

    # Start background threads
    threading.Thread(target=refresh_token_loop, daemon=True).start()
    subscribe_to_topics()

    threading.Thread(target=poll_notifications, daemon=True).start()

    def clearing_loop():
        """Background thread: periodic cleanup of polled data."""
        while True:
            time.sleep(CLEAR_INTERVAL)
            clear_polled_data()
    threading.Thread(target=clearing_loop, daemon=True).start()

    logger.info(f"📡 Monitoring active — polling every {POLL_INTERVAL} seconds.")
    logger.info("📂 Data will be cleared every 10 minutes")

    # Main processing loop
    while True:
        processed = process_one_id()
        if not processed:
            time.sleep(3)   # Small back-off when queue is empty