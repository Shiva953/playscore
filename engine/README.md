# score engine

The off-chain trading engine (see `docs/BACKEND.md`). `Engine::apply(ts, &Cmd)` is a
pure, deterministic, integer-only state transition; `wal::Sequencer` adds signatures, timestamps,
the hash-chained log and the file WAL.

```bash
cd engine
cargo test --release                       # 45 tests: exact rounding, pool, market, fuzzing (~2 s)
PROPTEST_CASES=3000 cargo test --release --test properties   # longer random-trading run (~30 s)
cargo run --release --example latency      # per-order latency, WAL group commit
```

## What's in it

- **Bonding curve** (spec §5): integer maths in milli-tokens, the 240k cap, 1.25% fee. The buy that
  crosses $25k graduates the market and its remainder buys from the new pool in the same command.
- **Seed ladder** at graduation: 30% in [0.75·p0, 1.33·p0], 30% in [0.4·p0, 2.5·p0], ~40% full
  range, opening at the curve's closing price.
- **Concentrated-liquidity pool** (Uniswap v3 maths in Q64.64, same rounding rules): range
  positions, fee growth inside ranges, 0.25% LP fee on input.
- **Order book + router**: price-time priority; every taker fills from the cheaper of book and
  pool; limit orders, post-only, cancel; self-trade prevention by cancelling the resting order.
- **Fees and tax**: 5 bps buy fee, sell tax 5% → 0.5% over 90 days that follows the seller in
  every venue, hold age blended through buys, LP deposits and withdrawals.
- **Rounds**: calendar, exact kickoff snapshot, pro-rata results, claims in USDC or tokens (+10%).
- **Custody**: on-chain deposit sequence, withdrawal locks for vouchers, paid / requested / released.
- **Integrity**: ed25519 user signatures on every order, stored in the log; borsh canonical
  encoding; hash chain; CRC-framed WAL with torn-tail recovery; Merkle state root and exit root.

## How the maths is tested

- Each fixed-point and CLMM primitive is checked against exact big-integer rationals: rounding must
  be exactly floor or ceil in the stated direction (hundreds of thousands of cases).
- Pool fuzzing: random ranges, swaps and withdrawals; the pool must cover every position's
  principal and fees at all times; round trips never profit; splitting never beats one trade.
- Engine fuzzing: random sequences of every command; after each one the full invariant set holds
  (custody equals liabilities exactly, token conservation, book and pool consistency, LP
  bookkeeping, pool solvency, claims, exit table backed by custody). Rejected commands change
  nothing, and the log replays to the same state root.
- Mutation checks: deliberately broken rounding, fee accounting and routing are each caught.

## Decisions

1. **Graduation (fixed).** In the reference program, a buy that overshoots $25k by about $0.50 or
   more makes `graduate` fail its own 8M-token check, so the market can't graduate. Here the curve
   part stops exactly at the threshold, the market graduates in the same command, and the rest of
   the order buys from the new pool at its opening price (the order fills completely).
2. **Protocol seed fees are withdrawable.** The seed principal stays locked forever; the fees it
   earns are collected by `CollectSeedFees` (run by the operator, e.g. every batch). USDC fees go
   to the treasury, which the multisig withdraws on-chain; `Params::seed_fee_vault_bps` can send a
   share to the dividend vault instead. Token fees are burned (the protocol never holds a position).
3. **Token-election price = pool price at the snapshot.** Manipulable around kickoff, as in the
   spec; a TWAP is the upgrade.
4. **Exit mode** pays users their USDC, unclaimed dividends, LP USDC sides, and a pro-rata share of
   each pool's USDC for their tokens. The vault and treasury stay for governance. (Confirmed.)
5. **Dust bids** (can't pay at least 1 micro-USDC) are cancelled and refunded during routing.
   (Confirmed.)

Engine parameters (`Params`) change only through the logged `SetParams` admin command, so a replay
always reproduces them.

## Facts from Solana

Commands reporting on-chain facts (`Deposit`, `WithdrawPaid`, `WithdrawTreasury`, `ReleaseLock`,
`BatchFinalized`, `Forced`, `ForcedUnpaid`) may only be submitted once the transaction they report
is **finalized**. The
engine moves first only when it reduces what users can spend (withdrawal locks, fees). Anything
that increases it waits for finalized USDC:
- deposits and payouts are numbered, and must arrive in the program's order;
- a lock is released only after the engine has applied every payout up to the finalized point
  the watcher checked;
- dividends are set aside by `RoundResult` and credited by `BatchFinalized`, once the batch that
  moved them from the vault into custody is final;
- forced requests (the user's on-chain escape hatch) are numbered too, and never refused for what
  they ask, so they can't stall the watcher. A forced withdrawal holds min(asked, free) as id
  `FORCED_ID_BIT | index` (paid by the program's `serve_forced`, reported as `WithdrawPaid`); a
  forced cancel cancels the user's own order; `ForcedUnpaid` returns a hold that was answered on-chain
  without a payment.

## Not verified

All arithmetic follows the spec text and the reference program's call sites; the client's
`score_math` crate (which defines the exact rounding) was not supplied. When it arrives, port its
test vectors into `tests/` and reconcile any difference.
