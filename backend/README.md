# score backend (`score-node`)

One process (Phase 1, devnet) around the engine library:

| Part | What it does |
|---|---|
| Engine + log | One thread owns the engine; commands are grouped, written to the log with one fsync, then acknowledged |
| API + live updates | `POST /v1/cmd` (user-signed commands), `/v1/withdraw/prepare` + `/v1/withdraw` (permit), `/v1/relay`, `/v1/admin/cmd` (oracle stand-in), `GET /v1/users/:pk`, `/v1/markets/:id`, `/v1/engine`, `/v1/status`, WebSocket `/v1/stream` |
| Permit signer | Signs the withdrawal permit after the engine has put the amount on hold |
| Relayer | Co-signs (as fee payer) only our deposit / withdraw / request-withdrawal transactions, with capped fees, never touching its own account; sends with rebroadcast |
| Chain watcher | `logsSubscribe` at finalized plus catch-up from history; applies deposits and payouts in the program's order; releases expired unused holds from finalized state |
| Batch committer | Every 10 s, and immediately for round results and large withdrawals; posts the engine's fingerprint and exit table, waits for finality, then credits set-aside dividends and settles large withdrawals (with the operator's approval, in the same transaction) |
| Forced requests | The watcher applies each finalized forced request in order and wakes the committer; the committer answers it with `serve_forced` inside the batch transaction when it fits (otherwise right after), paying a forced withdrawal straight to the user's wallet |
| Chain switches | On-chain pause flags and exit mode are mirrored in atomics: withdrawals are refused up front while paused (no hold, no failed transaction); exit mode stops orders, permits, relays and batches |
| Postgres writer | Copies every log record into Neon (`log` table), up to 500 rows per round trip; off the trading path; refills from the log file after an outage. TLS with channel binding (`pg_tls.rs`, because `tokio-postgres-rustls` 0.13's binding is broken). Off unless `DATABASE_URL` is set |

## Instant or request

`/v1/withdraw` decides when it puts the amount on hold (returned as `mode`; prepare's is a hint).
It counts the finalized view of the program's exposure cap plus every instant permit we've issued
that the view doesn't show yet. A permit stops counting once the program's payout counter has
passed its payout, or it was used as a request, or it expired unused (+2 minutes). So a view up to
1.5 s old can't make us promise an instant withdrawal the program would refuse, which would leave
the money on hold until the permit expired.

## Restart snapshots

The background follower (a copy of the engine replaying the saved log stream, at background
priority) writes `borsh(engine state)` to `.devnet/node/snapshot.bin` every 5,000 records or 60 s
(temp file, fsync, rename). On restart the node loads it only if its checksum matches and its
hash-chain head equals the log's at that sequence number, then re-applies just the log after it
(signatures and hashes still checked); otherwise it replays the whole log. Measured on 2026-11-06
with a 15k-record log: restart replay 435 ms → 10 ms, same state; a corrupted snapshot falls back
to the full replay. Still to do at scale: rotating old log segments (the log file is read in full).

## Engine log (`SCORE_ENGINE_LOG=1`)

The same follower prints one plain-language line per command, e.g.:

```
engine │ #2066 ICO BUY 5Z8g…adZ P14: $89.84 → 225,000 tokens (fee $1.11 → treasury) · curve price $0.000390→$0.000403 · raised $88.73 of $25,000 · 76 µs
engine │      ★ P14 GRADUATED: pool opens at $0.010960 with $17,560.64 + 1,594,402 tokens (70% of the raise, locked forever) · dividend vault +$5,000.00 · treasury +$2,511.63
engine │ #2117 SELL 5Z8g…adZ P14: 23,224 tokens → $247.35 · sell tax $13.02 (5.00% after 0.0 days held: 90% vault, 10% treasury) · routed: pool 23,224 tokens / order book 0 · price $0.011287→$0.011192
engine │ #2152 ROUND 13 RESULT: $300.00 for P14 → $300.00 set aside from the vault for 41 holders · credited only once the batch moving it into custody is final
```

It never touches the trading path, and it checks every record's hash against the engine's (a
live proof replay is exact). Off by default; the e2e turns it on (`SCORE_ENGINE_LOG=0` hides it).
`bun run latency:api [0|1] [cycles]` measures API latency with it off or on: three A/B pairs of
1,000 commands on 2026-11-06 gave a median of 3.1 ms either way, and p95 4.1–4.9 ms on vs 4.9–5.1 ms off.

## Run

```bash
bun run devnet:setup      # once: devnet keys in .devnet/, test USDC mint, program initialized
bun run node              # build + start on http://127.0.0.1:8787
bun run e2e:backend       # full end-to-end test on devnet (starts and kills the node itself)
```

Config: `NEXT_PUBLIC_SOLANA_RPC_DEVNET` (or `DEVNET_RPC`) = a Helius devnet URL, optional
`DATABASE_URL` (Neon), `SCORE_PORT`, `SCORE_WAL`; read from the environment or `.env.local` /
`.env`. Keys and the log live in `.devnet/` (gitignored).

## End-to-end test (`scripts/backend-e2e.ts`)

45 users with USDC and no SOL, acting only through the API and the relayer: deposits, ICO until
graduation, pool trades, limit orders, cancels, liquidity, a kill -9 + restart (with deposits made
while down), a dividend round, instant and over-the-cap withdrawals, a malicious relay attempt,
then reconciliation of the on-chain fingerprint, counters and every USDC against the engine.
Last run (2026-11-06, laptop → Helius devnet, Neon us-east-2): 13/13 checks passed, including
Neon holding every log record (read directly from Neon). The run prints every server event live
(credits, payouts, batches with Explorer links, refusals), Explorer links for sample transactions,
and the latest Neon rows; the full server log goes to `.devnet/node/last-run.log`.

| Action | Median |
|---|---|
| Deposit: click → spendable | 1.4 s |
| Order (ICO buy, pool buy/sell, limit, cancel, liquidity, claim), client round trip incl. signing and disk save | 4 ms |
| Withdrawal: click → USDC in wallet | 1.7 s |
| Large withdrawal (over the cap): click → wallet | 3.2–3.9 s |
| Forced withdrawal (posted on Solana by the user): post → wallet | 3.7 s |
| Dividend: round result → claimable | 1.6–2.3 s |
| Restart: process start → serving | 0.8–1.1 s (log replay 10 ms from a snapshot) |
