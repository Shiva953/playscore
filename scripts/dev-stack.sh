#!/usr/bin/env bash
# Bring the whole local dev stack up, in dependency order, from whatever broken state it is in.
# Idempotent: safe to re-run. Fails loudly at the first step that does not reach its check.
set -uo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32mok\033[0m %s\n' "$*"; }
bad() { printf '   \033[31mFAILED\033[0m %s\n' "$*"; }

RPC=http://127.0.0.1:8899
NODE=http://127.0.0.1:8787
ORACLE=http://127.0.0.1:8788

# macOS has no `xargs -r`; a for-loop over lsof output is portable.
killport() {
  local p pids
  pids=$(lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null)
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
}

wait_head() { # url seconds label
  local i=0
  while [ $i -lt "$2" ]; do
    if curl -sf -o /dev/null --max-time 2 "$1" 2>/dev/null; then ok "$3"; return 0; fi
    i=$((i+2)); sleep 2
  done
  bad "$3 not reachable at $1"; return 1
}

wait_rpc() {
  local i=0
  while [ $i -lt 120 ]; do
    if curl -sf -o /dev/null --max-time 2 -X POST -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC/" 2>/dev/null; then return 0; fi
    i=$((i+2)); sleep 2
  done
  return 1
}

say "1/7 stopping stale chain + backend processes"
pkill -x solana-test-validator 2>/dev/null
pkill -f 'release/score-node'     2>/dev/null
pkill -f 'services/oracle/main.ts' 2>/dev/null
pkill -f 'scripts/sim-traders.ts'  2>/dev/null
pkill -f 'scripts/stack.ts'        2>/dev/null
for p in 8899 9900 8787 8788; do killport $p; done
sleep 2
ok "ports 8899/9900/8787/8788 clear"

say "2/7 starting solana-test-validator"
rm -rf test-ledger
# The engine keeps its own state in .devnet/node (wal.log + snapshot.bin) and remembers which deposit
# cut the chain is on. Wiping the ledger without wiping that leaves the committer retrying forever —
# "deposit cut N not on the chain's ring (chain at 0)" — so nothing settles and no trades land.
# Reset both together or not at all.
if [ -f .devnet/node/wal.log ] || [ -f .devnet/node/snapshot.bin ]; then
  mkdir -p /tmp/score-state-backup
  stamp=$(date +%s)
  for f in wal.log snapshot.bin; do
    if [ -f ".devnet/node/$f" ]; then mv ".devnet/node/$f" "/tmp/score-state-backup/$f.$stamp"; fi
  done
  ok "engine state moved to /tmp/score-state-backup (matches the fresh chain)"
fi
nohup solana-test-validator --quiet --reset >/tmp/validator.log 2>&1 &
if wait_rpc; then ok "validator healthy"; else bad "validator never answered"; tail -20 /tmp/validator.log; exit 1; fi

say "3/7 deploying the score program"
solana program deploy --url "$RPC" \
  --program-id anchor/target/deploy/score-keypair.json \
  anchor/target/deploy/score.so 2>&1 | tail -3
ok "program deployed"

say "4/7 devnet:setup (keys, mint, initialize)"
if bun run devnet:setup 2>&1 | tail -15; then ok "devnet initialized"; else bad "setup failed"; exit 1; fi

say "5/7 starting score-node"
nohup ./backend/target/release/score-node >/tmp/score-node.log 2>&1 &
wait_head "$NODE/v1/view/head" 90 "score-node :8787" || { tail -25 /tmp/score-node.log; exit 1; }

say "6/7 starting oracle"
nohup bun services/oracle/main.ts >/tmp/oracle.log 2>&1 &
wait_head "$ORACLE/v1/health" 90 "oracle :8788" || { tail -25 /tmp/oracle.log; exit 1; }

say "7/7 starting simulated traders"
# Without these the market is frozen: the engine ticks but no trades land, so every page looks dead.
nohup bun scripts/sim-traders.ts >/tmp/bots.log 2>&1 &
sleep 8
if pgrep -f 'scripts/sim-traders.ts' >/dev/null; then ok "bots :/tmp/bots.log"; else bad "bots exited"; tail -20 /tmp/bots.log; fi

echo
if wait_head "http://127.0.0.1:3000/" 15 "next dev :3000"; then
  ok "restart it if pages are still blank: bun run dev"
else
  echo "   next dev is not running; start it with: bun run dev"
fi

echo
printf '\033[1;32mstack up\033[0m  node :8787 · oracle :8788 · validator :8899\n'
