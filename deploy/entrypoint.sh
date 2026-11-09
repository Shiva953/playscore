#!/bin/sh
# Writes devnet keys from env into .devnet/, seeds state on first boot, starts START=node|oracle.
set -e
mkdir -p /app/.devnet /data/node /data/oracle
for k in operator relayer voucher faucet; do
  v=$(printenv "KEY_$(echo $k | tr a-z A-Z)" || true)
  [ -n "$v" ] && printf '%s' "$v" > /app/.devnet/$k.json
done
[ -n "$ADMIN_TOKEN" ] && printf '%s' "$ADMIN_TOKEN" > /app/.devnet/admin-token
# One-time carry-over of the laptop's state (only if the volume is empty).
[ ! -f /data/node/wal.log ] && [ -f /app/seed/wal.log ] && cp /app/seed/wal.log /app/seed/snapshot.bin /data/node/ 2>/dev/null || true
[ ! -f /data/oracle/state.json ] && [ -f /app/seed/state.json ] && cp /app/seed/state.json /data/oracle/ || true
cd /app
if [ "$START" = "oracle" ]; then
  export ORACLE_HOST=0.0.0.0 ORACLE_PORT=${PORT:-8788} ORACLE_STATE=/data/oracle/state.json
  exec bun services/oracle/main.ts
fi
export SCORE_HOST=0.0.0.0 SCORE_PORT=${PORT:-8787} SCORE_WAL=/data/node/wal.log
exec ./score-node
