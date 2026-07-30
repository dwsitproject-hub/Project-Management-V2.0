#!/usr/bin/env bash
# Safe Docker cleanup for AliCloud STAGING frontend (172.28.92.56 / 8.215.6.189:3030).
# Does not remove volumes or stop running containers.
#
# Usage:
#   ./scripts/docker-cleanup-frontend-staging.sh          # check only (default)
#   ./scripts/docker-cleanup-frontend-staging.sh clean    # prune unused images & build cache
set -euo pipefail

CONTAINER_NAME="project_management_frontend_staging"
MODE="${1:-check}"

cd /opt/Project-Management-V2.0 2>/dev/null || true

echo "=== Host disk ==="
df -h / | tail -1

echo ""
echo "=== Docker disk usage ==="
docker system df -v 2>/dev/null || docker system df

echo ""
echo "=== Running containers (this host) ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Size}}\t{{.Image}}'

echo ""
echo "=== Images (all) ==="
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}'

echo ""
echo "=== Dangling / unused preview (no changes) ==="
echo "Dangling images:"
docker images -f dangling=true --format '  {{.ID}} {{.Repository}}:{{.Tag}} {{.Size}}' || true
echo ""
echo "Estimated reclaimable (dry-run):"
docker system df

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo ""
  echo "WARNING: $CONTAINER_NAME is not running."
  if [[ "$MODE" == "clean" ]]; then
    echo "Aborting cleanup. Start the staging frontend first:"
    echo "  docker compose -f docker-compose.staging.frontend.yml up -d"
    exit 1
  fi
  exit 0
fi

echo ""
echo "=== Staging frontend container ==="
docker ps --filter "name=$CONTAINER_NAME" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

if [[ "$MODE" != "clean" ]]; then
  echo ""
  echo "Check only. To free space, run:"
  echo "  ./scripts/docker-cleanup-frontend-staging.sh clean"
  exit 0
fi

echo ""
echo "=== Removing dangling images ==="
docker image prune -f

echo ""
echo "=== Removing unused images (keeps images used by running containers) ==="
docker image prune -a -f

echo ""
echo "=== Removing build cache ==="
docker builder prune -f

echo ""
echo "=== Removing stopped containers ==="
docker container prune -f

echo ""
echo "=== Removing unused networks ==="
docker network prune -f

echo ""
echo "=== Docker disk usage (after) ==="
docker system df

echo ""
echo "=== Host disk (after) ==="
df -h / | tail -1

echo ""
echo "=== Staging frontend still running ==="
docker ps --filter "name=$CONTAINER_NAME"
