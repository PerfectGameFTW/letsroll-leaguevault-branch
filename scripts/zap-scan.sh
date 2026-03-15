#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="$SCRIPT_DIR"
REPORT_FILE="$REPORT_DIR/zap-report.html"
TARGET_URL="${ZAP_TARGET_URL:-http://host.docker.internal:5001}"
ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:stable"

echo "============================================"
echo "  OWASP ZAP Baseline Scan"
echo "============================================"
echo ""

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is not installed or not in PATH."
  echo "Install Docker first: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running."
  echo "Start Docker and try again."
  exit 1
fi

echo "[1/3] Pulling OWASP ZAP image ($ZAP_IMAGE)..."
docker pull "$ZAP_IMAGE"
echo ""

echo "[2/3] Running baseline scan against $TARGET_URL ..."
echo "      (This is a passive scan — no destructive probing.)"
echo ""

docker run --rm \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  --add-host=host.docker.internal:host-gateway \
  "$ZAP_IMAGE" \
  zap-baseline.py \
    -t "$TARGET_URL" \
    -r zap-report.html \
    -I \
  || true

echo ""

if [ -f "$REPORT_FILE" ]; then
  echo "[3/3] Scan complete!"
  echo ""
  echo "  Report saved to: $REPORT_FILE"
  echo ""
  echo "  Open it in a browser to review findings."
else
  echo "[3/3] Scan finished but no report was generated."
  echo "  Check the output above for errors."
  exit 1
fi
