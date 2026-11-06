# score backend: the whole picture

How score's backend works: what each piece does, how the pieces connect, and where the money goes.

In the diagrams:
- a **dashed** box is a piece we haven't built yet;
- a **thick** arrow is USDC moving;
- a **dotted** arrow is something being checked.

For more detail, see `anchor/README.md`, `engine/README.md` and `backend/README.md`: how to run and test the code.

---

## 1. The idea in one minute

- **The money lives on Solana.** All users' USDC sits in one account that only our program can move, and only by its rules. We call it the *custody account*. No one person's key can take money out of it.
- **The trading happens on our server.** The *engine* keeps the record of who owns what: USDC balances, player tokens, orders and liquidity positions. It fills an order in about 30 microseconds, and trades cost nothing on Solana.
- **The two are tied together.**
  - Deposits and withdrawals are real Solana transactions, signed by the user.
  - Every 10 to 30 seconds, the engine posts a *fingerprint* of its whole record to the program.
  - Each time, the program checks that the custody account still holds enough USDC to cover everything the engine says users own.

The result is as fast as an exchange, while the money stays in an account no single key can drain.

---

## 2. The big picture

### 2.1 The three parts

```mermaid
flowchart TB
  subgraph USER["User's phone or browser"]
    APP["score app"]
    WAL[("Privy wallet<br/>the user's own USDC")]
  end
  subgraph SOL["Solana: score program"]
    CUST[("Custody account<br/>all users' USDC")]:::money
    ST["State<br/>fingerprint · counters · limits"]
  end
  SRV["Our servers<br/>keep the record of who owns what<br/>and fill every trade"]

  APP -->|"signed orders"| SRV
  SRV -->|"live prices · fills · balances<br/>withdrawal permits"| APP
  WAL ==>|"deposit"| CUST
  CUST ==>|"withdraw"| WAL
  SRV -->|"a batch every 10–30 s"| ST
  CUST -.->|"events: deposits, payouts"| SRV

  classDef money fill:#e6f4ea,stroke:#2f855a,color:#1a202c
```

- **Money moves only between the user's wallet and the custody account,** in Solana transactions the user signs.
- **Orders never touch Solana.** They go from the app to our servers and are filled there.
- **Our servers report to the program every 10–30 seconds,** and the program checks that report against the money it holds.

### 2.2 Inside our servers

```mermaid
flowchart LR
  APP["score app"]
  subgraph SRV["Our servers"]
    API["API + live updates<br/>orders in · prices and fills out"]
    ORA["Oracle<br/>match results"]:::planned
    CW["Chain watcher<br/>reads the program's events"]
    SEQ["Sequencer"]
    ENG["Engine"]
    LOG[("Log on disk")]
    PS["Permit signer<br/>permit goes back to the app"]
    DB[("Postgres<br/>history · charts")]
    BC["Batch committer"]
    WT["Watchtower"]:::planned
    REL["Relayer<br/>pays users' Solana fees"]
  end
  SOL[("Solana<br/>score program")]:::money

  APP <--> API
  API --> SEQ
  ORA --> SEQ
  CW -->|"deposit seen<br/>payout seen"| SEQ
  SEQ --> ENG --> LOG
  ENG -->|"amount on hold"| PS
  LOG --> DB
  LOG --> BC
  LOG -.-> WT
  BC -->|"batch every 10–30 s"| SOL
  WT -.->|"can pause"| SOL
  REL -->|"deposit and<br/>withdraw transactions"| SOL
  SOL -.->|"events"| CW

  classDef planned stroke-dasharray: 5 5
  classDef money fill:#e6f4ea,stroke:#2f855a,color:#1a202c
```

**One rule holds everything together:** every change, without exception, goes through the sequencer and lands in the log first. That covers:
- trades;
- deposits and withdrawals;
- dividends;
- admin changes.

The engine's memory, Postgres, the charts and the fingerprint are all rebuilt from the log. If they disagree with it, the log wins.

### 2.3 The pieces

| Piece | What it does | Runs on | Status |
|---|---|---|---|
| **score app** | The screens. Signs each order with the user's wallet key (no popup) | Vercel | Built (on mock data) |
| **Privy wallet** | The user's own wallet. Holds only USDC; users never need SOL | User's device | To connect |
| **API + live updates** | Takes orders in; streams prices, fills and balances out over a WebSocket | Railway, later AWS | Built (`score-node`), tested on devnet |
| **Sequencer** | Checks each order's signature, gives it the next number and the time, and puts it in one line | Engine machine | Built |
| **Engine** | Applies each action: curve, pools, order book, liquidity, fees, sell tax, rounds, claims | Engine machine (in memory) | Built, 45 tests |
| **Log** | Saves every action to disk before we say "done". Replaying it rebuilds everything exactly | Engine machine disk, plus a standby copy later | Built |
| **Permit signer** | Signs a withdrawal permit once the engine has put the amount on hold | Server; key in a hardware vault on mainnet | Built, tested on devnet |
| **Relayer** | Pays the Solana fee on users' deposit and withdrawal transactions; refuses anything else | Server | Built, tested on devnet |
| **Chain watcher** | Reads the program's events at finalized, catches up from history after gaps | Server | Built, tested on devnet (incl. restart catch-up) |
| **Batch committer** | Every 10–30 s, and straight away when a large withdrawal or a round result is waiting: works out the fingerprint and posts it to the program | Server (a second copy of the engine replaying the log) | Built, tested on devnet |
| **Postgres (Neon)** | Trade history, candles, portfolio. Not on the trading path, so it can't slow trades down | Neon | Built; waiting for the Neon database to test |
| **Oracle** | Match calendar, scores, and the dividend amount per player each round | Server | Plan step 4 |
| **Watchtower** | An independent copy that replays the public log, checks every number, and can pause | Separate machine | Later |
| **score program** | Holds the USDC, enforces the rules for money in and out, checks each batch | Solana | Built, 22 tests, deployed on devnet |

---

## 3. Inside the score engine

### 3.1 What happens to one action

```mermaid
flowchart LR
  IN["User orders<br/>signed in the app"] --> CHK
  SYS["System inputs<br/>deposit seen · payout seen<br/>round result · admin"] --> CHK

  subgraph SEQ["Sequencer"]
    CHK["1. Check the signature<br/>and the order counter"] --> NUM["2. Give it the next<br/>number and the time"]
  end

  subgraph ENGINE["Engine: one action at a time, all in memory"]
    APPLY["3. Apply"]
    MK["Player markets<br/>curve, or pool + order book"]
    AC["Accounts<br/>USDC and tokens per user"]
    RD["Rounds<br/>snapshots · dividends · claims"]
    APPLY --- MK
    APPLY --- AC
    APPLY --- RD
  end

  NUM --> APPLY
  APPLY -->|"4. Save to disk"| LOG[("Log")]
  LOG -->|"5. Reply"| OUT["Done, or the reason it failed<br/>back to the app"]
  LOG --> F1["Batch committer"]
  LOG --> F2["Postgres writer"]
  LOG --> F3["Live updates"]
```

The rules the engine follows:

- **All or nothing.** An action either fully happens or doesn't happen at all. A failed order changes nothing.
- **Same log in, same result out.** The engine never uses randomness, reads the clock, or uses decimals. All maths is in whole numbers, and rounding always goes in the protocol's favour, so it can never pay out a fraction it doesn't have. Anyone who replays the log gets the same balances to the last micro-cent. That is what lets a watchtower check us now, and a proof later.
- **Save before saying yes.** The reply goes out only after the action is on disk. Many actions share one disk write, which keeps this fast.
- **Every user order carries the user's signature.** The signature is stored in the log, so we can't invent trades for anyone.

**Speed:**
- **Engine:** an order takes about 31 µs in a typical case and 42 µs in the slowest 1%, including the signature check. That is about 30,000 orders a second on one core.
- **Disk:** saving to disk adds about 4 ms.

### 3.2 Life of a player market

```mermaid
stateDiagram-v2
  direction LR
  [*] --> ICO: admin lists the player
  ICO --> Trading: $25,000 raised
  ICO: ICO, priced by the bonding curve
  Trading: Trading, on the pool + order book
```

- **ICO (bonding curve).** Each player has 10M tokens.
  - The price starts at $0.00039 and rises with the square of the number of tokens sold, so early buyers pay less.
  - Every buy and sell goes against the curve.
  - There is a 1.25% fee, and no one can buy more than 240,000 tokens in one go or in total.
- **Graduation** happens inside the order that takes the raise past $25,000.
  - The order fills on the curve up to exactly $25,000. Whatever is left of it buys from the new pool straight away, so the order always fills completely.
  - The $25,000 is split three ways:
    - **70%** plus about 1.6M tokens goes into the new pool, placed in three fixed price bands around the opening price. This is the *protocol seed*: it can never be withdrawn.
    - **20%** goes to the **dividend vault**.
    - **10%** goes to the **treasury**.
- **Trading.** Users trade against the pool and against each other's limit orders. They can also add their own liquidity to the pool and earn its fees.

Of each player's 10M tokens:
- **8M** are for sale: sold on the curve, then put in the pool at graduation.
- **2M** are a reserve, paid out only when a holder takes a dividend as tokens (+10%).

Player tokens are entries in the engine, not Solana tokens, and they never leave the app.

### 3.3 How a trade gets filled

```mermaid
flowchart TD
  O["Buy order: spend $100"] --> Q{"Which is cheaper<br/>right now?"}
  Q -->|"a user's sell order"| B["Buy from that order"]
  Q -->|"the pool"| P["Buy from the pool, up to<br/>the next sell order's price"]
  B --> D{"All $100 spent, or<br/>the price limit reached?"}
  P --> D
  D -->|"no"| Q
  D -->|"yes"| F["Fees: 0.05% buy fee to the treasury<br/>0.25% pool fee stays in the pool"]
  F --> E["Tokens to the buyer<br/>one entry in the log"]
```

- **Selling works the same way**, from the other side.
- **Sell tax** depends on how long the seller has held the tokens: 5% at first, falling to 0.5% after 90 days. 90% of it goes to the dividend vault and 10% to the treasury.
  - It applies whether the seller sells to the pool or to another user, so the order book can't be used to dodge it.
- **Holding time** is an average. Buying more blends the new tokens in, so a top-up doesn't reset it to zero, and moving tokens into or out of the pool doesn't reset it either.
- **Your own orders.** If you would trade against your own resting order, that order is cancelled instead.

### 3.4 How the price is set (trading is off-chain, so where does it come from?)

No outside price feed is needed. The price comes from the pool's own balances, the same way it does on Uniswap or Orca. The only difference is that our engine does the arithmetic instead of a Solana program.

```mermaid
flowchart LR
  BUY["Someone buys"] -->|"USDC into the pool<br/>tokens out"| POOL
  SELL["Someone sells"] -->|"tokens into the pool<br/>USDC out"| POOL
  POOL["The player's pool<br/>holds USDC + tokens"] --> PX["Price right now<br/>buys push it up<br/>sells push it down"]
  PX --> WS["Live price in the app"]
  PX --> DB["Charts and history"]
  PX --> FP["Batch fingerprint<br/>on Solana"]
  PX --> SNAP["Kickoff snapshot<br/>price for token dividends"]
```

- **During the ICO,** the price is the curve formula applied to the number of tokens sold.
- **The order book doesn't set the price.** User orders sit around the pool price, and the router fills from whichever is cheaper. The best buy order is always at or below the pool price, and the best sell order at or above it.
- **Anyone can recompute the price.** It depends only on the trades in the public log, so replaying the log gives the same price.
- **It is committed on Solana.** The price is part of every batch fingerprint posted on-chain.
- **Dividends taken as tokens** use the pool price at the round's kickoff snapshot. An average price over a time window is a possible upgrade, because it is harder to push around just before kickoff.

---

## 4. Where the money sits

### 4.1 On Solana: the program's accounts

```mermaid
flowchart LR
  UW[("User's USDC account<br/>in their Privy wallet")]:::money
  CUST[("Custody account<br/>users' USDC")]:::money
  VAULT[("Dividend vault account")]:::money
  TRES[("Treasury account")]:::money
  TW[("Protocol wallet<br/>Squads multisig")]:::money

  UW ==>|"deposit"| CUST
  CUST ==>|"withdraw, with a permit<br/>large withdrawal after the next batch<br/>exit mode"| UW
  CUST ==>|"batch: new fees and taxes"| VAULT
  VAULT ==>|"batch: dividends credited"| CUST
  CUST ==>|"batch: new protocol revenue"| TRES
  TRES ==>|"withdraw_treasury<br/>multisig only"| TW

  subgraph REC["Record accounts: no money inside"]
    direction TB
    CONFIG["Config<br/>admin · keys · limits"]
    STATE["State<br/>fingerprint · deposit and payout counters<br/>pause · exit mode"]
    PAGE["Permit pages<br/>which permits are used"]
    REQ["Large withdrawal<br/>requests"]
    FORCED["Forced requests"]
    EXITED["Exited markers"]
    PEND["Pending log<br/>deposits and payouts<br/>since the last batch"]
    CONFIG ~~~ STATE ~~~ PEND
    PAGE ~~~ REQ ~~~ FORCED ~~~ EXITED
  end

  REC -.->|"checked on every move"| CUST

  classDef money fill:#e6f4ea,stroke:#2f855a,color:#1a202c
```

| Account | What's in it | Who can change it | How many |
|---|---|---|---|
| **Custody account** | Users' USDC: balances, orders, pools, unclaimed dividends. Plus the fees earned since the last batch, until that batch moves them out | Only the program, by its rules | One |
| **Dividend vault account** | USDC set aside for future dividends | Only a batch (in from custody, back to custody when dividends are credited) | One |
| **Treasury account** | Protocol revenue | In: only a batch, and a batch can only add. Out: only the multisig's `withdraw_treasury` | One |
| **Three authorities** | Nothing. Each is the program's signature for one of the three token accounts above (a "PDA": an address with no private key) | The program only | Three |
| **Config** | The admin, the three service keys, the limits | The admin | One |
| **State** | The latest fingerprint and exit table, the deposit and payout counters, how much the treasury may withdraw, pause and exit-mode flags | The program, during each instruction | One |
| **Permit page** | One bit per permit id (8,192 per page), so each permit works only once | The program | One per 8,192 withdrawals (about 0.008 SOL each) |
| **Large withdrawal request** | One withdrawal above the cap, waiting for the next batch | The program; closed when paid, rent refunded | Only while waiting |
| **Forced request** | A user's request that the engine must serve | The user creates it and pays | Rare |
| **Exited marker** | Shows a user has already been paid in exit mode | The program | Only in exit mode |
| **Pending log** | Every deposit and payout since the last batch: who, how much, which permit | The program, on every deposit and payout | One (~98 KB, ~0.5 SOL rent, one time) |

The program stores no balance for any user. The engine keeps all of those, and the chain only holds the fingerprint of them. That's why trades cost nothing on Solana and no one pays rent for an account per user.

Each money account has its **own authority**, so an instruction can only move money from the account it signs for:
- `withdraw_treasury` can sign only for the treasury, so the multisig can never reach user money;
- a batch can add to the treasury but never take from it.

### 4.2 How the engine and the accounts stay in sync

The engine's balances are a record of who owns which part of the USDC. Most changes to them never move USDC on Solana. When Alice buys from Bob, Alice's balance goes down and Bob's goes up, all inside custody. Only four things move USDC between accounts, each at a fixed point:

**The rule:** whichever side gives up money moves first. The engine moves first only when it *reduces* what users can spend. Anything that *increases* what users can spend waits until the USDC is on Solana, in a **finalized** block. "Confirmed" (optimistic) is never enough.

| What happens | Which side moves first | How the other side catches up | If the Solana side fails |
|---|---|---|---|
| Deposit | Solana: wallet → custody | Once the deposit is **finalized**, the watcher reports "deposit n", and the engine credits it (only n, right after n−1) | Nothing was credited |
| Withdrawal | Engine: the amount goes on hold (users can spend less), and a permit is issued | The user's transaction pays it. Once **finalized**, the watcher reports "payout n" (numbered like deposits), and the engine removes the hold | The hold stays. It's released only when finalized Solana state shows the permit expired unused, and only after the engine has applied every payout up to that point |
| Fees and taxes | Engine: its vault and treasury figures grow (users can't spend that money) | Each batch moves the difference since the last batch from custody into the vault and treasury accounts | Custody keeps the extra until the next batch |
| Dividends | **Solana first:** the round result only *sets aside* the payout; the next batch moves it from the vault into custody | Once that batch is **finalized**, the watcher reports it, and the engine credits the holders | Nobody was credited. The next batch moves the same amount |
| Treasury withdrawal | Solana: multisig → protocol wallet | Once **finalized**, the watcher reports "payout n", and the engine lowers its treasury figure | Nothing changed |

The program records the vault and treasury figures of every batch, so a batch can only move "new figure minus last figure". A failed batch simply means the next one moves the larger difference: nothing is moved twice or skipped. After the move, it checks that custody still covers everything owed to users.

**Every report from Solana is numbered** (deposit n, payout n), so a missed or repeated report is refused instead of silently skipped. Every batch is also checked on-chain against the program's own counts.

### 4.3 The engine's boxes

Every dollar in the three money accounts belongs to exactly one of these boxes. The dividend vault and treasury boxes live in their own accounts; the rest live in custody. Three small diagrams show how money moves between them.

**Trading** moves money between users' free balances and the markets:

```mermaid
flowchart LR
  FREE["Free balance<br/>per user"]
  ORD["In buy orders"]
  ICO["ICO pot<br/>per player"]
  POOL["Pool USDC<br/>per player,<br/>incl. user liquidity"]
  VAULT["Dividend vault"]
  TRES["Treasury"]
  FREE ==>|"limit buy order"| ORD
  ORD ==>|"cancelled → back<br/>filled → to the seller"| FREE
  FREE ==>|"ICO buy"| ICO
  ICO ==>|"ICO sell"| FREE
  FREE ==>|"buy · add liquidity"| POOL
  POOL ==>|"sell · remove liquidity"| FREE
  ICO ==>|"at $25,000: 70%"| POOL
  ICO ==>|"20%"| VAULT
  ICO ==>|"10%"| TRES
```

A trade between two users, through the order book, moves USDC from the buyer's balance to the seller's.

**Fees and dividends** fill the dividend vault and the treasury, and pay holders:

```mermaid
flowchart LR
  TRADE{{"Every trade"}} ==>|"buy fees<br/>10% of sell tax"| TRES["Treasury"]
  TRADE ==>|"90% of sell tax"| VAULT["Dividend vault"]
  SEED["Protocol seed's<br/>pool fees"] ==> TRES
  VAULT ==>|"round result"| CLAIM["Unclaimed dividends"]
  CLAIM ==>|"claim as USDC"| FREE["Free balance"]
  CLAIM ==>|"claim as tokens:<br/>the USDC stays"| VAULT
  TRES ==>|"multisig withdraws"| TW(("treasury wallet<br/>on Solana"))
```

**In and out** is the only path between a user's wallet and these boxes:

```mermaid
flowchart LR
  W1(("user's wallet")) ==>|"deposit"| FREE["Free balance"]
  FREE ==>|"withdraw"| HOLD["On hold"]
  HOLD ==>|"paid on Solana"| W2(("user's wallet"))
  HOLD ==>|"permit expired unused"| FREE
```

**The check that keeps it honest:**

```
custody + vault + treasury USDC  =  free balances  +  on hold  +  in buy orders  +  ICO pots
                                 +  pool USDC  +  unclaimed dividends  +  dividend vault  +  treasury
```

This is an exact equality, not just "at least":
- **In the tests,** it is checked after every single action, across thousands of random trading runs.
- **On Solana,** every batch moves the vault and treasury figures into their accounts, then checks that custody covers everything else (what users are owed).

### 4.4 Fees: who pays what, and where it goes

| When | Charge | Goes to |
|---|---|---|
| ICO buy | 1.25% | Treasury |
| ICO sell | 1.25% | 90% dividend vault, 10% treasury |
| Graduation | The $25,000 raised | 70% pool (locked forever), 20% dividend vault, 10% treasury |
| Buy after graduation | 0.05% | Treasury |
| Any trade against the pool | 0.25% pool fee | Stays in the pool. Liquidity providers earn it by their share |
| Sell after graduation | Sell tax: 5%, falling to 0.5% over 90 days of holding | 90% dividend vault, 10% treasury |
| The protocol seed's share of pool fees | Its part of the 0.25% | Treasury (a setting can send part to the dividend vault). The token part is destroyed |
| Dividend taken as tokens | +10% bonus tokens from the player's reserve | The USDC stays in the dividend vault for future rounds |

---

## 5. Money in and out, step by step

### 5.1 Deposit (spendable in about 1 second)

```mermaid
sequenceDiagram
  participant U as User (app + wallet)
  participant P as score program
  participant W as Chain watcher
  participant E as Engine
  U->>P: deposit $50 (user signs, relayer pays the fee)
  P->>P: wallet → custody, logged as deposit no. 812
  P-->>W: event: deposit 812, user, $50
  Note over W: waits until the block is finalized (~0.8 s)
  W->>E: deposit 812
  E->>E: free balance +$50
  E-->>U: new balance, live
```

The money becomes spendable only once its block is finalized. Since Solana's Alpenglow upgrade (mainnet, 21 Oct 2026), "confirmed" and "finalized" are the same moment. On devnet we measured finality at 0.79 s median after sending (0.43–1.6 s, 12 transactions), so waiting for finality costs no time.

**A deposit can't be lost or counted twice:**
- The program counts every deposit and keeps a running fingerprint of all of them.
- The engine only accepts deposit 812 right after 811.
- Each batch must say exactly how many deposits it includes, and the program checks that against its own count. If the engine skipped one, the next batch would fail.

### 5.2 Withdrawal (about 1 second)

```mermaid
sequenceDiagram
  participant U as User
  participant E as Engine
  participant S as Permit signer
  participant P as score program
  participant W as Chain watcher
  U->>E: withdraw $50 (signed)
  E->>E: free −$50, on hold +$50
  E->>S: $50 is on hold for this user
  S-->>U: permit: user, $50, id 9001, valid 5 min
  U->>P: withdraw with the permit (user signs, relayer pays the fee)
  P->>P: check the permit's signature, the user,<br/>the expiry, id unused, and the cap
  P->>U: custody → user's wallet, in the same transaction
  P-->>W: event: payout 77 for permit 9001
  Note over W: waits until finalized
  W->>E: payout 77: permit 9001 paid
  E->>E: on hold −$50 (it has left custody)
```

**Why the permit is needed.** The program can't see live balances, because they change with every trade in the engine. So the engine signs a short note saying *"this $50 is set aside for this user and can't be spent on anything else."*

**The permit is safe on its own.** It:
- only pays the user who signs the transaction;
- works once;
- expires after a few minutes.

**The cap.** Instant withdrawals made since the last batch can't add up to more than a limit. For example, the larger of $25,000 and 2% of custody (numbers to be agreed with the client). If the permit key were ever stolen, that is the most it could take before the next batch check and a pause stop it.

**If the permit is never used,** the amount stays on hold until all three of these are true:
- the watcher sees, in finalized Solana state, a block whose clock is past the permit's expiry, with the permit still unused;
- the engine has applied every payout up to that point, so a payout of this permit can't still be on its way;
- 60 seconds of margin have passed on the engine's clock.

Only then does it go back to the free balance. The program refuses an expired permit, so the money can't be both returned and paid out.

### 5.3 Large withdrawal (above the cap)

```mermaid
sequenceDiagram
  participant U as User
  participant P as score program
  participant E as Engine
  participant R as Relayer (or anyone)
  U->>P: withdraw $100,000 with a permit
  P->>P: over the cap: record a request, mark the permit used
  P-->>E: event: request recorded (via the chain watcher)
  E->>E: keep the $100,000 on hold (never returned on expiry)
  Note over P: the committer posts a batch at once (~1 s)
  R->>P: settle the request
  P->>U: custody → user's wallet
  P->>R: request closed, its rent refunded
```

### 5.4 Treasury withdrawal

1. Each batch moves new protocol revenue from custody into the treasury account, and records the engine's treasury figure.
2. The multisig withdraws from the treasury account (never from custody), up to that figure, to any USDC account it chooses.
3. The chain watcher tells the engine, and the engine lowers its treasury figure.
4. Only one treasury withdrawal is allowed at a time. The next batch must show the engine has recorded it.
5. Treasury withdrawals don't count against the users' instant-withdrawal cap.

---

## 6. Batches: how Solana keeps the engine honest

Every 10 to 30 seconds, the batch committer sends one small transaction. The committer is a second copy of the engine that replays the log, and the operator key signs the batch.

The batch contains:
- **the fingerprint** of every balance, order, pool and claim;
- **the exit table:** what each user would get if everything stopped now;
- **the end of the log;**
- how many deposits and payouts it includes;
- the total the engine holds;
- the dividend vault and treasury figures, so the program can move the change into those accounts.

```mermaid
flowchart LR
  C["New batch<br/>signed by the operator key"] --> K1{"Next number,<br/>builds on the<br/>last fingerprint?"}
  K1 -->|"yes"| K2{"Deposits and payouts<br/>match the program's<br/>own counters?"}
  K2 -->|"yes"| K4{"Treasury figure<br/>not lower than<br/>last time?"}
  K4 -->|"yes"| K3{"After moving the change<br/>into vault and treasury,<br/>custody still covers<br/>what users are owed?"}
  K3 -->|"yes"| OK["Saved: new fingerprint<br/>and exit table. Vault and<br/>treasury moved. The cap<br/>starts again"]
  K4 -->|"no"| X
  K1 -->|"no"| X["Rejected"]
  K2 -->|"no"| X
  K3 -->|"no"| X
```

**What batches don't check yet (Phase 1).** The program doesn't check that every trade was worked out correctly; it trusts the operator's signature for that.
- **Today:** the public log and the watchtower cover this. Anyone can replay the log and compare the result with the fingerprint.
- **Phase 2:** a proof is added to each batch, so the program itself checks every trade. The engine is already written for this: whole numbers only, same log in, same result out. The program only needs one extra input.

---

## 7. When something goes wrong

```mermaid
flowchart TD
  BAD["Something looks wrong"] --> PZ["Pause key: stop deposits<br/>or withdrawals"]
  PZ --> ADM["Multisig investigates,<br/>then unpauses or swaps keys"]
  CEN["The engine ignores a user,<br/>or goes offline"] --> FR["User posts a forced request<br/>on Solana"]
  FR --> T{"Served within<br/>the deadline?"}
  T -->|"yes"| NORMAL["Back to normal"]
  T -->|"no"| EXIT["Exit mode<br/>anyone can switch it on<br/>it can't be undone"]
  DOWN["No batch for too long"] --> EXIT
  EXIT --> PAY["Each user withdraws their line<br/>of the last exit table, once"]
```

- **Pausing.**
  - The pause key can only pause; only the multisig can unpause.
  - A trading pause in the engine stops new trades only. Deposits, withdrawals, cancels, removing liquidity and claims keep working, so a pause never traps anyone's money.
- **Forced request.** If our servers ignore a user, or are down, the user can post a request directly on Solana: withdraw an amount (or everything free), or cancel one of their orders. The engine has to answer it within a deadline, for example 24 hours.
  - How it's answered: the watcher applies the request once it is final, and the engine puts the amount on hold. The committer then answers it on Solana with `serve_forced` inside the next batch transaction (no extra transaction), which pays the USDC straight into the user's wallet and returns their rent. Measured on devnet: about 3.7 s from posting to USDC in the wallet.
  - A batch can't mark a request answered; only `serve_forced` can, one at a time, in order. So a request can't be skipped quietly.
  - A request that asks for something impossible (no balance, someone else's order, an unknown kind) is still answered, with no effect, so nobody can use forced requests to stall us into exit mode.
  - With no USDC account to pay into, or withdrawals paused, it's answered without payment and the hold goes back to the user's balance.
- **The server follows the chain's switches.** It mirrors the on-chain pause flags and exit mode in memory. While withdrawals are paused it refuses them up front, so nothing goes on hold and no transaction fails. In exit mode it stops taking orders, permits and relays, and stops posting batches.
- **Exit mode.** If a forced request is ignored, or no batch arrives for a set time (for example 3 days), anyone can switch on exit mode. It is permanent. Each user is then paid once. They get their line of the last exit table, which holds:
  - their free USDC and their buy orders;
  - their unclaimed dividends;
  - the USDC side of their liquidity positions;
  - a fair share of each pool's USDC for the tokens they hold, with no sell tax;
  - any withdrawal on hold that was never paid.

  That line is then adjusted for what happened on Solana after the last batch:
  - deposits made after the batch are added, so no deposit is ever stuck;
  - withdrawals already paid after the batch are taken off, so no one is paid twice.

  The program keeps the deposits and payouts since the last batch in its **pending log**. To make that possible, deposits and withdrawals pause if they get more than 1,024 ahead of the last batch, and start again as soon as the next batch lands. Someone who only deposited after the last batch gets their deposits back with no proof needed. The app proves everyone else's line against the fingerprint on Solana, so the user doesn't have to do anything technical.
- **The dividend vault and treasury** stay in their own accounts in exit mode, for the multisig to decide what happens to them. Exit payments come only from custody.

---

## 8. A round: dividends

```mermaid
sequenceDiagram
  participant O as Oracle
  participant E as Engine
  participant H as Holders
  O->>E: calendar: round 7 kicks off Saturday 15:00
  Note over E: trading never stops
  E->>E: at kickoff, snapshot every holder of every player
  Note over O: matches play, then a 12 h check period
  O->>O: final scores → $ per player (sized from the dividend vault)
  O->>E: round 7 result: $ per player
  E->>E: set aside from the vault (nobody credited yet)
  Note over E: next batch moves it: vault account → custody
  Note over E: batch finalized on Solana
  E->>E: credit holders by snapshot share
  H->>E: claim as USDC → free balance
  H->>E: or claim as tokens → +10% more tokens
```

- **The snapshot is exact.** It counts every holder's tokens at kickoff, including tokens in sell orders and the token side of liquidity positions. The protocol seed doesn't count.
- **Dividends are chain-first.** The result only sets the money aside. The committer posts a batch straight away when a result arrives, and holders are credited once that batch is finalized, about 1–2 seconds later. Custody therefore always holds the USDC before anyone can claim or withdraw it.
- **The split always rounds down,** so the engine never pays out more than the vault holds. The leftover fractions stay in the vault.
- **Claiming as tokens** gives 10% more tokens from the player's reserve, priced at the snapshot. The USDC stays in the vault for future rounds.

---

## 9. Everything together: one user's week

```mermaid
sequenceDiagram
  actor A as Alice (in the app)
  participant S as Our servers
  participant P as score program
  participant O as Oracle
  Note over A,O: Monday: money in
  A->>P: deposit $200
  P-->>S: deposit seen
  S-->>A: free balance $200
  Note over A,O: Tuesday: ICO
  A->>S: buy $100 of Player X (signed)
  S-->>A: tokens at the curve price
  Note over S: Player X passes $25,000 → its pool opens
  Note over A,O: Saturday: match day
  O->>S: kickoff
  S->>S: snapshot: Alice holds Player X
  O->>S: round result: $ for Player X
  S-->>A: dividend to claim
  A->>S: claim as USDC
  Note over A,O: Sunday: sell and cash out
  A->>S: sell half (sell tax by holding time)
  A->>S: withdraw $150
  S-->>A: permit ($150 on hold)
  A->>P: withdraw with the permit
  P->>A: $150 in her wallet, same transaction
  P-->>S: payout seen
  Note over S,P: all week: a batch every 10–30 s
```

---

## 10. Keys: who can do what

| Key | Held by | Can | Can't |
|---|---|---|---|
| **Admin** | Squads multisig on mainnet; its own keypair on devnet | Change limits, swap the service keys, unpause, withdraw from the treasury account (up to the batch figure) | Touch custody or the dividend vault |
| **Operator** | Batch committer | Post batches, which move the vault and treasury change | Pay anyone; take from the treasury; post a batch that fails the checks in §6 |
| **Permit signer** | Permit service (hardware vault on mainnet) | Sign withdrawal permits | Pay anyone except the signing user; go over the cap; reuse a permit |
| **Pause key** | Watchtower / on-call person | Pause | Unpause |
| **User** | Their Privy wallet | Sign orders, deposit, withdraw their own money, post forced requests, exit | Act for anyone else |
| **Upgrade key** | The deployer wallet now; the multisig, with a delay, on mainnet | Upgrade the program. Only this key could run the one-time setup | |

On mainnet, the upgrade key must sit behind the multisig and a time delay, because whoever can upgrade the program can change its rules.

---

## 11. Where it runs, speed and cost

| Part | Now | Later |
|---|---|---|
| Engine, sequencer, log, services | Railway | AWS: a dedicated machine, plus a standby copy that saves every action too |
| Database | Neon Postgres | Same |
| Program | Ready for devnet | Mainnet, with upgrades through the multisig |
| App | Vercel | Same |

| What | Number |
|---|---|
| Engine time per order | ~31 µs typical, ~42 µs for the slowest 1% |
| Saving to disk | ~4 ms (measured on a laptop; server disks vary) |
| Deposit | 1 Solana transaction, ~$0.001 fee paid by the relayer. **Measured on devnet through our program:** sent → finalized → program event at the watcher in 1.09 s median (0.97–2.2 s, 15 deposits) |
| Withdrawal | 1 Solana transaction with the permit. **Measured on devnet:** sent → finalized in the user's wallet in 1.11 s median (0.96–1.35 s, 15 withdrawals) |
| Batch | Measured on devnet: finalized in 1.37 s |
| A trade | Nothing on Solana |
| A batch | 1 small transaction every 10–30 s, plus one straight away when a large withdrawal or a round result needs it |
| Program compute | deposit 7.9k, withdraw 10.4k, batch 7.7k (11.7k with both sweeps); worst-case exit 108k (a transaction may use up to 1.4M) |
| Putting the program on Solana | ~2.42 SOL, one time (477 KB), plus ~0.5 SOL for the pending log |

---

## 12. Built and next

| Status | What |
|---|---|
| **Built and tested** | The engine (45 tests, plus a 3,000-run random trading test), the program (22 tests on a local Solana simulator, deployed on devnet), the backend server (`score-node`: API, permit signer, relayer, chain watcher, batch committer, tested end to end on devnet, 12/12 checks), and the TypeScript client generated from the program |
| **Next** | Test the Postgres writer on Neon; switch the app from mock data to the real API (no visible change) |
| **Plan step 4** | The oracle: calendar, match data, scoring, round results |
| **Later** | Watchtower, standby copy, Phase 2 proofs |

---

## Words used in this doc

| Word | Meaning |
|---|---|
| **Custody account** | The one Solana account that holds every user's USDC |
| **Engine** | Our trading server's core. It keeps the record of who owns what and fills orders |
| **Sequencer** | The front door of the engine. It checks signatures and puts actions in one line |
| **Log** | The saved list of every action, in order. Everything else is rebuilt from it |
| **Batch** | The small transaction posted to Solana every 10–30 s |
| **Fingerprint** (state root) | A short code worked out from every balance. If any balance changed, the code would change, so once it's on Solana, history can't be quietly rewritten |
| **Exit table** | What each user gets if everything stops. Posted with every batch |
| **Permit** (voucher) | The engine's signed note that an amount is on hold for one user's withdrawal |
| **Cap** | The most that can be withdrawn instantly between two batches |
| **Bonding curve / ICO** | A player's first sale, at a price set by a formula |
| **Graduation** | When a player's ICO reaches $25,000 and the pool opens |
| **Pool** | The player's built-in market maker. It always has a price and always trades |
| **Order book** | Users' limit orders to buy or sell at a set price |
| **Liquidity provider (LP)** | A user who adds USDC and tokens to the pool and earns its 0.25% fee |
| **Protocol seed** | The pool money from graduation. Locked forever |
| **Dividend vault** | USDC set aside for round dividends |
| **Treasury** | The protocol's revenue, withdrawn by the multisig |
| **Relayer** | Our server that pays Solana fees, so users never need SOL |
| **Multisig** | A wallet that needs several people to approve each action (Squads) |
