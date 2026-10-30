#!/bin/zsh
# P7 check 10: SIGTERM with an open SSE stream and a slow upload in flight.
# Runs the built API from the temporary clone on port 4199 with apps/api/.env.test (universe_test).
# Usage: shutdown.sh <clone>/repo <out-dir>
set -u
REPO=$1; OUT=$2
cd "$REPO/apps/api"
ST=$(mktemp -d /tmp/p7-storage.XXXX)
PORT=4199 STORAGE_DIR=$ST LOG_LEVEL=info node --env-file=.env.test dist/server.js > "$OUT/server.log" 2>&1 &
PID=$!
for i in {1..50}; do curl -sf localhost:4199/api/health/live >/dev/null && break; sleep 0.2; done
J=$(mktemp)
PW=$(/usr/bin/grep '^SEED_DEMO_PASSWORD=' .env.test | cut -d= -f2-)
curl -s -c "$J" -H 'Content-Type: application/json' -d "{\"email\":\"student@universe.test\",\"password\":\"$PW\"}" localhost:4199/api/auth/login > /tmp/p7-login.json
CSRF=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).csrfToken)' /tmp/p7-login.json)
curl -s -N -b "$J" localhost:4199/api/activity/stream > "$OUT/sse.txt" 2>&1 &
SSE=$!
{ printf '%%PDF-1.4\n'; head -c 3000000 /dev/zero; } > /tmp/p7-big.pdf
curl -s -o "$OUT/upload.json" -w 'upload http=%{http_code} exit=' --limit-rate 300k -b "$J" -H "X-CSRF-Token: $CSRF" -F "file=@/tmp/p7-big.pdf;type=application/pdf" localhost:4199/api/files/hub.resource > "$OUT/upload.txt" 2>&1 &
UP=$!
sleep 2
T0=$(date +%s.%N)
kill -TERM $PID
wait $PID; RC=$?
T1=$(date +%s.%N)
wait $SSE; SSE_RC=$?
wait $UP; UP_RC=$?
echo "$UP_RC" >> "$OUT/upload.txt"
echo "server exit code=$RC after $(( T1 - T0 )) s; sse curl exit=$SSE_RC; upload curl exit=$UP_RC" | tee "$OUT/summary.txt"
curl -s -m 1 localhost:4199/api/health/live >/dev/null && echo "STILL LISTENING" || echo "port 4199 closed" | tee -a "$OUT/summary.txt"
