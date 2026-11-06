# score program (Anchor)

Phase 1 custody program for score (see `docs/BACKEND.md`). It holds all user USDC in one
PDA-owned custody account (with the dividend vault and treasury in two more, each with its own
authority), makes deposits and withdrawals instant and on-chain, and bounds what the
off-chain engine's operator can do. Trading itself runs in the engine (`../engine`).

Program id (devnet): `3tP3HKuoPDYKvUuGUYeRXbNQZHQeHU5BabRCwZwcXELo`

## Build and test

Toolchain: Anchor CLI 1.2.2 (`avm use 1.2.2`), anchor-lang / anchor-spl 1.2.2, Rust 1.98 (host,
pinned in `rust-toolchain.toml`), Solana CLI 3.1.x, litesvm 0.18.2.

```bash
bun run program:test            # anchor build (program + IDL) and all program tests, with CU printout
# or, from anchor/:
anchor build --ignore-keys --arch v2   # -> target/deploy/score.so, target/idl/score.json
                                # (--arch v2: Anchor 1.2.2 defaults to sBPF v3, which devnet
                                #  and mainnet haven't enabled yet; the deploy would be refused)
cargo test                      # 22 tests on litesvm, no validator and no SOL needed
cargo test --test custody       # one area: admin | custody | batch | escape
bun run codama:js               # regenerate the TS client (src/generated/score) from the IDL
```

The tests run the real `.so` on litesvm, and the exit-mode test pays out from an exit proof built
by the real engine (`score-engine`).

## Devnet (deployed)

`3tP3HKuoPDYKvUuGUYeRXbNQZHQeHU5BabRCwZwcXELo` on devnet (sBPF v2, upgrade authority = the CLI
wallet), initialized by `bun run devnet:setup` and run by the backend (`backend/`,
`bun run e2e:backend`). The program-only test (`bun run e2e:devnet`) refuses to run against it,
because it bypasses the engine. The first deployment (`2qqSX…`) was closed and its SOL reclaimed.

Upgrading: a new build larger than the deployed program needs
`solana program extend <program id> <bytes>` first (it was extended by 20 KB on 2026-11-06).

## Deploy to devnet

`Anchor.toml` defaults to localnet, so builds and tests never touch devnet. To deploy:

```bash
solana config set --url devnet          # wallet: ~/.config/solana/id.json
solana balance                          # needs ~4.6 SOL at the peak of the deploy
bun run program:deploy:devnet           # = anchor deploy --provider.cluster devnet
```

The program account keeps ~2.42 SOL of rent (477 KB); the deploy buffer (another ~2.42 SOL) is
refunded when the deploy completes. The deployer wallet is the upgrade authority, so it is the only
key that can call `initialize`. `initialize` also needs the `Pending` log account (~98 KB, ~0.50 SOL
rent): the same transaction must first create it with a system `create_account` (owner = this
program, space = 8 + `size_of::<Pending>()`), because it is larger than a program may create.

## Layout

```
src/
  lib.rs                      #[program]: one line per instruction, dispatching to its handler
  constants.rs  error.rs  events.rs
  shared.rs                   pay_out, payout chain, exposure cap, voucher acceptance
  verify.rs                   Ed25519 introspection, hash chains, Merkle proofs (engine contract)
  state/                      config, ledger (hot state), pending (activity since the last batch), voucher_page, requests, args
  instructions/
    admin/                    initialize, set_keys, set_limits, transfer_admin, set_pause, withdraw_treasury
    custody/                  init_voucher_page, deposit, withdraw, request_withdrawal, settle_request
    batch/                    commit_batch
    escape/                   force_request, enter_exit_mode, exit_withdraw
tests/
  common/mod.rs               litesvm harness
  admin.rs  custody.rs  batch.rs  escape.rs
```

## Instructions

| Instruction | Signer | What it does |
|---|---|---|
| `initialize` | program upgrade authority | Config, state, the custody / vault / treasury token accounts (each with its own authority PDA), `Pending` log; sets admin, keys, limits. Checks the fixed accounts match the constants in `constants.rs` |
| `set_keys`, `set_limits` | admin | Rotate operator / voucher / pauser keys; change limits |
| `nominate_admin`, `accept_admin` | admin, then nominee | Two-step admin transfer (Squads multisig on mainnet) |
| `set_pause` | admin or pauser | Pause deposits / withdrawals. The pauser can only add flags |
| `deposit` | user | USDC wallet → custody; extends the deposit hash chain; recorded in `Pending` (at most 1,024 ahead of the last batch) |
| `withdraw` | user (+ Ed25519 voucher ix) | Pays custody → user in the same tx, within the exposure cap; recorded in `Pending` (at most 1,024 ahead) |
| `request_withdrawal` | user | Records a voucher above the cap, paid after the next batch |
| `settle_request` | anyone, or the operator | Pays a recorded request once a later batch is committed (not in exit mode). Anyone: within the instant cap. With the operator's signature: above the cap (two keys needed to exceed it), and kept out of the cap |
| `commit_batch` | operator | New state root and exit root; checks deposit / payout cuts; moves the change in the engine's vault and treasury figures (custody ↔ vault, custody → treasury only); checks custody still covers what users are owed |
| `withdraw_treasury` | admin | From the treasury account only (signs only for it), up to the committed treasury figure; one at a time per batch; not counted against the users' exposure cap |
| `init_voucher_page` | anyone (pays rent) | Bitmap of 8,192 voucher ids |
| `force_request` | user (pays) | Censorship escape: must be answered within `forced_deadline`. Kind 0 = withdraw `data[0..8]` (0 = all free), 1 = cancel order `data[0..8]`; others are answered with no effect |
| `serve_forced` | operator | Answers the oldest unanswered forced request (strictly in order). A withdrawal pays at most what was asked, to the user's USDC account, as payout id `FORCED_ID_BIT \| index`, outside the instant cap; closes the request and returns its rent to the user. Batches can't mark requests answered (`forced_served` must stay as is) |
| `enter_exit_mode` | anyone | Ignored forced request, or no batch for `liveness_deadline`. Irreversible |
| `exit_withdraw` | user | Exit mode, once per user: the committed exit leaf + deposits after that batch − voucher payouts after it for locks not in the leaf; pays unsettled requests whose lock is in the leaf. A forced hold in the leaf is paid unless `serve_forced` paid it after the cut (read from the `Pending` log) |

Compute (litesvm, Anchor 1.2.2, 2026-11-06): deposit ~8.8k CU, withdraw ~11.6k CU incl. the Ed25519 check, commit_batch ~8.7k CU (~12.7k with both sweeps), serve_forced (paying) ~11.5k CU, exit_withdraw over two full `Pending` logs ~114k CU (worst case).

How it's kept low (after the Helius "Optimizing Solana programs" guide, measured before and after):
- No PDA derivation on the hot paths: the fixed accounts (config, state, the three authorities)
  are checked against precomputed addresses (`constants.rs`, pinned by `tests/addresses.rs`), and
  accounts created per item (voucher pages, requests, forced requests) are identified by their
  type plus their stored index, since only `init` at their own PDA can create them. This took
  withdraw from 24.7k to 10.9k CU and deposit from 11.7k to 8.4k.
- Zero-copy for every account read on each instruction (`Config`, `State`, `Pending`, voucher
  pages): no deserialization. `Config` alone saved ~500 CU per instruction.
- Not adopted: dropping Anchor's instruction-name log (~110 CU, but it identifies failures in
  explorers), and the guide's no-std / unsafe-syscall techniques (the guide itself advises against
  them for programs that hold money).

## Security review against the Helius checklist

([A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security))

| # | Class | How it's handled |
|---|---|---|
| 1 | Account data matching | `address =` for fixed accounts; `has_one = admin / usdc_mint / custody / vault / treasury / pending`; operator via `constraint`; token accounts via `token::mint` / `token::authority` |
| 2 | Reallocation | No account is ever resized |
| 3 | Reloading after CPI | No account is read after a CPI; the custody balance for the cap is read before the transfer |
| 4 | Arbitrary CPI | Only SPL Token, pinned by `Program<'info, Token>`; the Ed25519 program id is checked in introspection |
| 5 | Authority transfer | `nominate_admin` / `accept_admin` (two-step); keys rotatable via `set_keys` |
| 6 | Bump canonicalisation | `init` uses canonical bumps; fixed PDAs are precomputed constants with their canonical bumps, checked at `initialize` and in `tests/addresses.rs` |
| 7 | Closing accounts | `close = rent_to` (Anchor) on paid requests, with `rent_to` pinned to the recorded payer |
| 8 | Duplicate mutable accounts | Anchor 1.x rejects duplicates; a user's token account and custody can't alias (different authority); `to != custody` on treasury withdrawals |
| 9 | Front-running | Vouchers bind user, amount, id, expiry and program id; `commit_batch` must extend the committed root and sequence |
| 10 | Insecure initialisation | `initialize` requires the program's upgrade authority (ProgramData check); `init` prevents re-initialisation |
| 11 | Precision | Integer-only; the cap multiplies before dividing in u128 |
| 12 | Ownership | `Account<'info, T>` / `AccountLoader` check owner + discriminator; remaining accounts checked by hand (14 below) |
| 13 | Signer checks | `Signer<'info>` on every authority; tested by stripping the user's signer flag |
| 14 | Overflow | `overflow-checks = true` in release; all arithmetic checked; `try_from` for narrowing |
| 15 | PDA sharing | One prefix per role: `config`, `state`, `custody`, `custody_auth`, `vault`, `vault_auth`, `treasury`, `treasury_auth`, `voucher_page`, `withdraw_request`, `forced_request`, `exited`. Each token account has its own authority, so an instruction can only move money from the account it signs for |
| 16 | Remaining accounts | `exit_withdraw` verifies each voucher page's PDA address, owner, discriminator and writability |
| 17 | Rust panics | No `unwrap`, no indexing on untrusted data (`get` with bounds), no `unsafe` |
| 18 | Seed collisions | Fixed-width suffixes behind distinct prefixes |
| 19 | Type cosplay | Anchor discriminators on every program account |

Ed25519 introspection (voucher signatures) rejects: a missing or foreign verify instruction, more
than one signature, offsets pointing into another instruction's data (all indexes must be
`u16::MAX`), out-of-range offsets, a wrong key, and a wrong message. Each case has a test.

## Phase 1 trust model (what the program does not yet guarantee)

- A batch is signed by the operator, not proven. The program checks the deposit and payout cuts
  against its own chains and that custody covers the claimed liabilities, but not that the state
  root is the correct result of the trades. Phase 2 adds a validity proof to `commit_batch`.
- Exit mode protects against the operator disappearing or censoring, not against a false root.
  It rolls trading back to the last batch; on-chain deposits and withdrawals after that batch are
  settled from the `Pending` log. A user who withdrew trading gains made after the batch can't be
  charged back; that loss is bounded by the exposure cap.
- The per-user withdrawal cap is enforced by the engine. On-chain enforcement would need a rented
  account per user; the on-chain global exposure cap bounds the worst case.
- Events use `emit!` (logs). The engine's indexer reads them; the hash chains make missed or
  reordered events detectable.
