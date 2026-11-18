#!/bin/bash
# Deploys ~/Documents/Mathsy/mathsy-meet-server to the Oracle SFU host and restarts it.
set -e
KEY=~/.ssh/mathsy-meet.key
HOST=ubuntu@152.67.5.129
cd ~/Documents/Mathsy/mathsy-meet-server

echo "== 1/3 Uploading code =="
rsync -a -e "ssh -i $KEY" --exclude node_modules --exclude .env --exclude dist --exclude data ./ "$HOST":/opt/mathsy-meet-server/

echo "== 2/3 Setting media port range 40000-40199 =="
ssh -i "$KEY" "$HOST" "cd /opt/mathsy-meet-server && (grep -q '^MEDIASOUP_MAX_PORT=' .env && sed -i 's/^MEDIASOUP_MAX_PORT=.*/MEDIASOUP_MAX_PORT=40199/' .env || echo 'MEDIASOUP_MAX_PORT=40199' >> .env) && grep '^MEDIASOUP_MAX_PORT=' .env"

echo "== 3/3 Installing, building and restarting =="
ssh -i "$KEY" "$HOST" "cd /opt/mathsy-meet-server && npm ci && npm run build && pm2 restart mathsy-meet-server --update-env && pm2 ls"

echo "== DONE: SFU deployed =="
