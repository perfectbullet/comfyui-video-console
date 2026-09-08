#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HOST="${REMOTE_HOST:-zenking@192.168.8.231}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/aigc/comfyui-h3}"

cd "$ROOT"
npm run build

rsync -az --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.vite/' \
  --exclude='*.log' \
  ./ \
  "${REMOTE_HOST}:${REMOTE_ROOT}/web/"

ssh "${REMOTE_HOST}" \
  "cd '${REMOTE_ROOT}' && docker compose up -d --build vue-web"
