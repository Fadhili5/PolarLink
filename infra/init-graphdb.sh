#!/bin/bash
# Initialize GraphDB repository for NE:ONE

GRAPHDB_URL="http://localhost:7200"
REPO_ID="neone"
MAX_RETRIES=30
RETRY_COUNT=0

echo "Waiting for GraphDB to be ready..."

# Wait for GraphDB to be accessible
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s "$GRAPHDB_URL/rest/repositories" > /dev/null 2>&1; then
    echo "✓ GraphDB is ready"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "  Attempt $RETRY_COUNT/$MAX_RETRIES - GraphDB not ready yet, waiting..."
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "✗ GraphDB failed to start after $MAX_RETRIES attempts"
  exit 1
fi

# Check if repository already exists
echo "Checking for existing '$REPO_ID' repository..."
REPOS=$(curl -s "$GRAPHDB_URL/rest/repositories" | grep -o "\"id\":\"$REPO_ID\"")

if [ -z "$REPOS" ]; then
  echo "Creating '$REPO_ID' repository..."
  
  # Create repository configuration
  curl -s -X POST \
    "$GRAPHDB_URL/rest/repositories" \
    -H "Content-Type: application/json" \
    -d '{
      "id": "'$REPO_ID'",
      "title": "NE:ONE ONE Record Repository",
      "repositoryType": "GraphStore",
      "params": {
        "ruleset": {
          "name": "ruleset",
          "value": "empty"
        },
        "checkForInconsistencies": {
          "name": "checkForInconsistencies",
          "value": "true"
        },
        "baseURL": {
          "name": "baseURL",
          "value": "http://localhost:8080"
        }
      }
    }' > /dev/null
  
  if [ $? -eq 0 ]; then
    echo "✓ Repository '$REPO_ID' created successfully"
    sleep 2
  else
    echo "✗ Failed to create repository"
    exit 1
  fi
else
  echo "✓ Repository '$REPO_ID' already exists"
fi

echo "GraphDB initialization complete!"
