#!/usr/bin/env bash
# Arranca/pára o servidor local de testes (porta 5055, API + frontend compilado)
set -e
PIDFILE=/tmp/claude-0/bazzar-server.pid
LOG=/tmp/claude-0/api.log
cd "$(dirname "$0")/.."
if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
  kill "$(cat $PIDFILE)" || true
  sleep 1
fi
rm -f "$PIDFILE"
[ "$1" = "stop" ] && exit 0
export DATABASE_URL=${DATABASE_URL:-postgres://bazzar:bazzar@localhost:5432/bazzar}
export PORT=5055 NODE_ENV=production COOKIE_SECURE=false SESSION_SECRET=local-test-secret PAYMENTS_MODE=${PAYMENTS_MODE:-sandbox} SEED_DEMO=true
if [ -f dist/index.js ] && [ "$2" != "tsx" ]; then
  nohup node dist/index.js > "$LOG" 2>&1 &
else
  nohup npx tsx server/index.ts > "$LOG" 2>&1 &
fi
echo $! > "$PIDFILE"
for i in $(seq 1 30); do
  if curl -s localhost:5055/api/health >/dev/null 2>&1; then echo "servidor pronto"; exit 0; fi
  sleep 1
done
echo "servidor não arrancou"; tail -20 "$LOG"; exit 1
