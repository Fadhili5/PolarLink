# NE:ONE Setup & Integration Skill

## Overview

**NE:ONE** is an open-source ONE Record server implementation by the Digital Testbed Air Cargo (DTAC) initiative, funded by the German Federal Ministry for Digital and Transport. It provides a fully IATA ONE Record API (v2.2) and data model (v3.2.0) compliant server for cargo digital twin representation.

- **Repository**: https://git.openlogisticsfoundation.org/wg-digitalaircargo/ne-one
- **Official Container Registry**: `git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one`
- **Standards**: IATA ONE Record API v2.2, Data Model v3.2.0, CARGO Ontology v3.2.0

## When to Use This Skill

Use this skill when:
- Setting up NE:ONE for ONE Record integration
- Configuring Docker Compose with NE:ONE services
- Troubleshooting NE:ONE connectivity or authentication
- Integrating Keycloak with NE:ONE for JWT token authentication
- Adding GraphDB persistence, TLS/mTLS, or advanced NE:ONE features
- Debugging ONE Record client requests

## Container Registry & Image URLs

### Official Images (Correct Source)
```
git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:dev
git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one/ne-one-mtls:latest
```

### Common Mistakes
❌ `ghcr.io/ddoeppner/ne-one-server` — **NOT the official image, may fail with 403**
✅ `git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one` — **Official image**

## Docker Deployment Options

### Minimal Setup (In-Memory Data)
```bash
docker run -d --name neone \
    -p 8080:8080 \
    git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
```

This starts:
- NE:ONE server on `localhost:8080`
- In-memory RDF store (data lost on container stop)
- No authentication (development only)

### Docker Compose (Minimal)
```yaml
services:
  ne-one-server:
    image: git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
    ports:
      - "8080:8080"
    environment:
      # Optional Keycloak configuration
      AUTH_ENABLED: "true"
      QUARKUS_OIDC_ISSUER: http://keycloak:8989/realms/neone
```

### Docker Compose with GraphDB Persistence
```yaml
services:
  graphdb:
    image: ontotext/graphdb:10.8.4
    ports:
      - "7200:7200"
    volumes:
      - graphdb-data:/opt/graphdb/data

  ne-one-server:
    image: git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
    ports:
      - "8080:8080"
    depends_on:
      - graphdb
    environment:
      REPOSITORY_TYPE: http
      HTTP_REPOSITORY_URL: http://graphdb:7200/repositories/neone
      LO_ID_CONFIG_HOST: localhost
      LO_ID_CONFIG_SCHEME: http
      LO_ID_CONFIG_PORT: 8080

volumes:
  graphdb-data:
```

## Keycloak Integration

### NE:ONE Keycloak Expectations

NE:ONE expects JWT tokens from Keycloak with:
- **Default Issuer URL**: `http://localhost:8989/realms/neone`
- **Default JWKS Endpoint**: `http://localhost:8989/realms/neone/protocol/openid-connect/certs`
- **Custom Claim**: `logistics_agent_uri` (set per client, e.g., `http://localhost:8080/logistics-objects/_data-holder`)

### Keycloak Setup (NE:ONE Provided)

Start the included Keycloak instance:
```bash
cd src/main/docker-compose  # If building from source
docker compose -f docker-compose.keycloak.yml up -d
```

Or configure your own Keycloak with:
- **Realm**: `neone` (or any name)
- **Client ID**: `neone-client`
- **Client Secret**: `lx7ThS5aYggdsMm42BP3wMrVqKm9WpNY` (or custom)
- **Grant Type**: `client_credentials`
- **Scope**: `profile email`

### JWT Token Generation Example

For AeroSentinel's OneRecordClient:

```bash
# Get token from Keycloak
curl -X POST "http://localhost:8089/realms/neone/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'neone-client:lx7ThS5aYggdsMm42BP3wMrVqKm9WpNY' | base64)" \
  -d "grant_type=client_credentials&client_id=neone-client"

# Response includes access_token, expires_in, token_type
# Use: Authorization: Bearer <access_token>
```

## NE:ONE Configuration Properties

Common Quarkus configuration properties:

| Property | Default | Purpose |
|----------|---------|---------|
| `repository-type` | `in-memory` | `in-memory`, `native`, `http` (GraphDB), or `sparql` |
| `http-repository-url` | `http://localhost:7200/repositories/neone` | GraphDB repository URL |
| `lo-id-config.host` | `localhost` | External hostname for object IRIs |
| `lo-id-config.scheme` | `http` | URL scheme (`http` or `https`) |
| `lo-id-config.port` | `8080` | External port |
| `quarkus.oidc.auth-server-url` | — | Keycloak base URL |
| `quarkus.oidc.client-id` | — | Keycloak client ID |
| `quarkus.oidc.credentials.secret` | — | Keycloak client secret |
| `quarkus.cache.enabled` | `false` | Enable Redis caching |
| `quarkus.redis.hosts` | — | Redis connection (if caching enabled) |

### Setting Configuration via Environment Variables

```bash
export REPOSITORY_TYPE=http
export HTTP_REPOSITORY_URL=http://graphdb:7200/repositories/neone
export QUARKUS_OIDC_AUTH_SERVER_URL=http://keycloak:8989
export QUARKUS_OIDC_CLIENT_ID=neone-client
"QUARKUS_OIDC_CREDENTIALS_SECRET=your-secret" \
export LO_ID_CONFIG_HOST=localhost
export LO_ID_CONFIG_SCHEME=http
export LO_ID_CONFIG_PORT=8080

docker run -d \
  -p 8080:8080 \
  -e REPOSITORY_TYPE \
  -e HTTP_REPOSITORY_URL \
  -e QUARKUS_OIDC_AUTH_SERVER_URL \
  -e QUARKUS_OIDC_CLIENT_ID \
  -e QUARKUS_OIDC_CREDENTIALS_SECRET \
  -e LO_ID_CONFIG_HOST \
  -e LO_ID_CONFIG_SCHEME \
  -e LO_ID_CONFIG_PORT \
  git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
```

## ONE Record API Endpoints

### Creating a Logistics Object

```bash
curl -X POST http://localhost:8080/logistics-objects \
  -H 'Accept: application/ld+json' \
  -H 'Content-Type: application/ld+json' \
  -d '{
    "@context": {
      "@vocab": "https://onerecord.iata.org/ns/cargo#"
    },
    "@type": "cargo:Piece",
    "handlingInstructions": [
      {
        "@type": "cargo:HandlingInstructions",
        "hasDescription": "Temperature Sensitive",
        "isOfHandlingInstructionsType": "PCI"
      }
    ]
  }'
```

### Fetching a Logistics Object (Requires Auth)

```bash
# Get ULD data with Bearer token
curl -X GET http://localhost:8080/logistics-objects/uld-ABC123 \
  -H 'Authorization: Bearer <ACCESS_TOKEN>' \
  -H 'Accept: application/ld+json; version=2.0.0-dev'
```

### Response Format (JSON-LD)

```json
{
  "@context": "https://onerecord.iata.org/ns/cargo#",
  "@id": "http://localhost:8080/logistics-objects/uld-ABC123",
  "@type": "cargo:Piece",
  "serialNumber": "ABC123",
  "latestTemperatureRecord": {
    "@type": "cargo:TemperatureRecord",
    "temperatureValue": 5.2,
    "measuredAtTime": "2026-04-25T10:30:00Z",
    "location": {
      "airportCode": "JFK"
    }
  },
  "relativeHumidity": {
    "value": 65
  },
  "temperatureComplianceStatus": {
    "status": "COMPLIANT",
    "exposureUsed": 15,
    "exposureRemaining": 45
  }
}
```

## Advanced Features

### GraphDB Persistence Setup

Ensure GraphDB repository is created:

```bash
# Start GraphDB
docker compose -f docker-compose.graphdb-server.yml up -d

# Verify repository exists
curl http://localhost:7200/rest/repositories
# Should include "neone" repository

# Configure NE:ONE
docker run -d \
  -p 8080:8080 \
  -e REPOSITORY_TYPE=http \
  -e HTTP_REPOSITORY_URL=http://graphdb:7200/repositories/neone \
  git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
```

### TLS/mTLS Configuration

For production deployments, enable TLS:

```bash
docker compose -f docker-compose.yml \
  -f docker-compose.tls.yml \
  up -d
```

NE:ONE serves on port 8443 with TLS enabled.

### Redis Caching for Remote Objects

Enable caching of remote Logistics Objects:

```yaml
services:
  redis:
    image: redis:7.4-alpine
    ports:
      - "6379:6379"

  ne-one-server:
    environment:
      QUARKUS_CACHE_ENABLED: "true"
      QUARKUS_REDIS_HOSTS: redis://redis:6379
      QUARKUS_REDIS_HEALTH_ENABLED: "true"
```

## AeroSentinel Integration Checklist

When integrating NE:ONE with AeroSentinel:

- [ ] Use correct registry: `git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one`
- [ ] Keycloak running on port 8989 (or 8081 if using different instance)
- [ ] Keycloak realm: `neone` with client `neone-client`
- [ ] OneRecordClient configured with correct Keycloak endpoint
- [ ] NE:ONE accessible at `http://localhost:8080` (or configured host)
- [ ] GraphDB running (if using persistent storage)
- [ ] JWT token generation working: `POST /realms/neone/protocol/openid-connect/token`
- [ ] Test ULD fetch: `GET /logistics-objects/uld-{id}` with Bearer token

## Docker Compose Integration (AeroSentinel)

```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.6.1
    ports:
      - "8989:8080"  # NE:ONE expects Keycloak on 8989
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    # ... realm imports ...

  graphdb:
    image: ontotext/graphdb:10.8.4
    ports:
      - "7200:7200"

  ne-one-server:
    image: git.openlogisticsfoundation.org:5050/wg-digitalaircargo/ne-one:latest
    ports:
      - "8080:8080"
    environment:
      REPOSITORY_TYPE: http
      HTTP_REPOSITORY_URL: http://graphdb:7200/repositories/neone
      QUARKUS_OIDC_AUTH_SERVER_URL: http://keycloak:8080  # Internal Docker network
      QUARKUS_OIDC_CLIENT_ID: neone-client
      QUARKUS_OIDC_CREDENTIALS_SECRET: lx7ThS5aYggdsMm42BP3wMrVqKm9WpNY
      LO_ID_CONFIG_HOST: localhost
      LO_ID_CONFIG_SCHEME: http
      LO_ID_CONFIG_PORT: 8080
    depends_on:
      - keycloak
      - graphdb
```

## Troubleshooting

### Image Pull Errors
**Problem**: `failed to resolve reference "git.openlogisticsfoundation.org:5050/..."`

**Solution**: 
- Ensure Docker has internet access
- Verify image name spelling
- No authentication needed for pull (public registry)

### Keycloak Connection Fails
**Problem**: `Failed to get Keycloak token: Connection refused`

**Solution**:
- Verify Keycloak is running: `docker ps | grep keycloak`
- Check port mapping: Keycloak should be on 8989 (internal) or 8080 (standard)
- Update OneRecordClient with correct endpoint: `http://keycloak:8089/realms/neone`
- For Docker Compose, use service name: `http://keycloak:8080/realms/neone`

### GraphDB Repository Not Found
**Problem**: `Failed to initialize HTTP repository client`

**Solution**:
- Verify GraphDB is running: `curl http://localhost:7200/rest/repositories`
- Create repository named `neone` if missing
- Check `HTTP_REPOSITORY_URL` matches GraphDB setup

### JWT Token Invalid
**Problem**: `401 Unauthorized` when accessing logistics objects

**Solution**:
- Verify token generation works independently
- Check token expiry: tokens are typically valid for 5 minutes
- Ensure `Authorization: Bearer <token>` header format
- Verify client secret in Keycloak matches OneRecordClient config

### NE:ONE Port Conflicts
**Problem**: `Error response from daemon: bind: address already in use`

**Solution**:
- Check current port usage: `docker ps`, `netstat -an`
- Change NE:ONE port in docker-compose to 8081, 8082, etc.
- Update backend config `ONE_RECORD_BASE_URL` to match new port

## References

- **NE:ONE Repository**: https://git.openlogisticsfoundation.org/wg-digitalaircargo/ne-one
- **ONE Record API Spec**: https://github.com/IATA-Cargo/ONE-Record/tree/master/Documentation_website/docs/
- **ONE Record Data Model**: https://github.com/IATA-Cargo/ONE-Record/blob/master/working_draft/API/ONE-Record-API-Ontology.ttl
- **IATA ONE Record**: https://www.iata.org/en/services/it-solutions/standards/one-record/
- **Quarkus Configuration**: https://quarkus.io/guides/config

## Contact & Contributing

- **Contact**: oliver.ditz@iml.fraunhofer.de
- **Contributing**: See CONTRIBUTING.md in NE:ONE repository
- **Funding**: German Federal Ministry for Digital and Transport (DTAC initiative)
