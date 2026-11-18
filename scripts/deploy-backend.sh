#!/bin/bash
# Builds the backend locally and deploys it to the Oracle host (pm2: mathsy-meet-control-plane).
# Keeps the previous build as /opt/mathsy-meet/dist-server.bak for instant rollback.
set -e
KEY=~/.ssh/mathsy-meet.key
HOST=ubuntu@152.67.5.129
cd ~/Documents/Mathsy/mathsy-meet

echo "== 1/3 Building backend =="
npm run -s build:server

echo "== 2/3 Backing up current build and uploading =="
ssh -i "$KEY" "$HOST" "cd /opt/mathsy-meet && rm -rf dist-server.bak && cp -r dist-server dist-server.bak"
rsync -a --delete -e "ssh -i $KEY" dist-server/ "$HOST":/opt/mathsy-meet/dist-server/

echo "== 3/3 Restarting backend =="
ssh -i "$KEY" "$HOST" "pm2 restart mathsy-meet-control-plane --update-env && sleep 4 && pm2 ls && curl -s -m 5 http://127.0.0.1:\$(grep -E '^PORT=' /opt/mathsy-meet/.env | cut -d= -f2 || echo 5001)/api/health/live; echo"

echo "== DONE: backend deployed (rollback: ssh in, then: cd /opt/mathsy-meet && rm -rf dist-server && mv dist-server.bak dist-server && pm2 restart mathsy-meet-control-plane) =="
