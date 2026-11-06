//! Shared litesvm harness for the score program tests. Build the program first (`anchor build`):
//! the tests load `target/deploy/score.so`.
#![allow(dead_code, unused_imports)]

pub use anchor_lang::solana_program::program_pack::Pack;
pub use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
pub use anchor_spl::token::spl_token;
pub use ed25519_dalek::{Signer as DalekSigner, SigningKey};
pub use litesvm::LiteSVM;
pub use score::constants::*;
pub use score::state::*;
pub use score::verify::{deposit_link, voucher_message};
pub use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};

pub const USDC: u64 = 1_000_000;

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &score::ID).0
}
pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}
pub fn state_pda() -> Pubkey {
    pda(&[STATE_SEED])
}
pub fn custody_pda() -> Pubkey {
    pda(&[CUSTODY_SEED])
}
pub fn custody_auth_pda() -> Pubkey {
    pda(&[CUSTODY_AUTH_SEED])
}
pub fn vault_pda() -> Pubkey {
    pda(&[VAULT_SEED])
}
pub fn vault_auth_pda() -> Pubkey {
    pda(&[VAULT_AUTH_SEED])
}
pub fn treasury_pda() -> Pubkey {
    pda(&[TREASURY_SEED])
}
pub fn treasury_auth_pda() -> Pubkey {
    pda(&[TREASURY_AUTH_SEED])
}
pub fn page_pda(id: u64) -> Pubkey {
    pda(&[PAGE_SEED, &(id / PAGE_BITS).to_le_bytes()])
}

pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: score::ID,
        accounts: accounts.to_account_metas(None).into_iter().map(|m| AccountMeta { pubkey: m.pubkey, is_signer: m.is_signer, is_writable: m.is_writable }).collect(),
        data: data.data(),
    }
}

/// Ed25519 program instruction verifying one signature, all data inline (indexes = u16::MAX).
pub fn ed25519_ix(key: &SigningKey, msg: &[u8]) -> Instruction {
    ed25519_ix_raw(&key.verifying_key().to_bytes(), &DalekSigner::sign(key, msg).to_bytes(), msg, u16::MAX)
}
pub fn ed25519_ix_raw(pk: &[u8; 32], sig: &[u8; 64], msg: &[u8], ix_index: u16) -> Instruction {
    let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
    let mut d = vec![1u8, 0];
    for v in [sig_off, ix_index, pk_off, ix_index, msg_off, msg.len() as u16, ix_index] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    d.extend_from_slice(pk);
    d.extend_from_slice(sig);
    d.extend_from_slice(msg);
    Instruction { program_id: Pubkey::from_str_const("Ed25519SigVerify111111111111111111111111111"), accounts: vec![], data: d }
}

pub struct T {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub operator: Keypair,
    pub pauser: Keypair,
    pub voucher: SigningKey,
    pub mint: Pubkey,
    pub mint_auth: Keypair,
    /// The `Pending` log account (a keypair account, created in the `initialize` transaction).
    pub pending: Pubkey,
}

impl T {
    pub fn new() -> Self {
        Self::with_limits(Limits { exposure_cap_min: 1_000 * USDC, exposure_cap_bps: 200, voucher_max_ttl: 300, forced_deadline: 86_400, liveness_deadline: 3 * 86_400 })
    }

    pub fn with_limits(limits: Limits) -> Self {
        let mut svm = LiteSVM::new();
        let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/score.so")).expect("build the program first: cargo build-sbf");
        svm.add_program(score::ID, &so).unwrap();
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        let mut t = T {
            svm,
            admin,
            operator: Keypair::new(),
            pauser: Keypair::new(),
            voucher: SigningKey::from_bytes(&[42u8; 32]),
            mint: Pubkey::new_unique(),
            mint_auth: Keypair::new(),
            pending: Pubkey::default(),
        };
        t.set_upgrade_authority(Some(t.admin.pubkey()));
        for k in [t.operator.pubkey(), t.pauser.pubkey()] {
            t.svm.airdrop(&k, 10_000_000_000).unwrap();
        }
        // USDC-like mint, 6 decimals.
        let mut data = vec![0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint { mint_authority: Some(t.mint_auth.pubkey()).into(), supply: 0, decimals: 6, is_initialized: true, freeze_authority: None.into() }.pack_into_slice(&mut data);
        t.put(t.mint, data, spl_token::ID);
        let r = t.initialize(&t.admin.insecure_clone(), limits);
        r.unwrap();
        t
    }

    pub fn put(&mut self, at: Pubkey, data: Vec<u8>, owner: Pubkey) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm.set_account(at, Account { lamports, data, owner, executable: false, rent_epoch: 0 }).unwrap();
    }

    pub fn set_upgrade_authority(&mut self, who: Option<Pubkey>) {
        let pd = Pubkey::find_program_address(&[score::ID.as_ref()], &anchor_lang::solana_program::bpf_loader_upgradeable::ID).0;
        let mut acc = self.svm.get_account(&pd).unwrap();
        // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> } (bincode)
        acc.data[12] = who.is_some() as u8;
        acc.data[13..45].copy_from_slice(&who.unwrap_or_default().to_bytes());
        self.svm.set_account(pd, acc).unwrap();
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        self.send_cu(ixs, signers).map(|_| ())
    }

    /// Send and return the compute units consumed.
    pub fn send_cu(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<u64, String> {
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&signers[0].pubkey()), signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx).map(|m| m.compute_units_consumed).map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
    }

    pub fn initialize(&mut self, authority: &Keypair, limits: Limits) -> Result<(), String> {
        let pending = Keypair::new();
        let space = 8 + std::mem::size_of::<Pending>();
        // System program CreateAccount { lamports, space, owner } (bincode: u32 tag 0, then fields).
        let mut data = vec![0u8; 4];
        data.extend_from_slice(&self.svm.minimum_balance_for_rent_exemption(space).to_le_bytes());
        data.extend_from_slice(&(space as u64).to_le_bytes());
        data.extend_from_slice(score::ID.as_ref());
        let create = Instruction {
            program_id: anchor_lang::solana_program::system_program::ID,
            accounts: vec![AccountMeta::new(authority.pubkey(), true), AccountMeta::new(pending.pubkey(), true)],
            data,
        };
        let pd = Pubkey::find_program_address(&[score::ID.as_ref()], &anchor_lang::solana_program::bpf_loader_upgradeable::ID).0;
        let keys = Keys { operator: self.operator.pubkey(), voucher_signer: Pubkey::new_from_array(self.voucher.verifying_key().to_bytes()), pauser: self.pauser.pubkey() };
        let accounts = score::accounts::Initialize {
            authority: authority.pubkey(),
            program: score::ID,
            program_data: pd,
            config: config_pda(),
            state: state_pda(),
            pending: pending.pubkey(),
            custody_auth: custody_auth_pda(),
            custody: custody_pda(),
            vault_auth: vault_auth_pda(),
            vault: vault_pda(),
            treasury_auth: treasury_auth_pda(),
            treasury: treasury_pda(),
            usdc_mint: self.mint,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        };
        let admin = self.admin.pubkey();
        let r = self.send(&[create, ix(accounts, score::instruction::Initialize { admin, keys, limits })], &[authority, &pending]);
        if r.is_ok() {
            self.pending = pending.pubkey();
        }
        r
    }

    /// A funded user with a USDC token account holding `usdc`.
    pub fn user(&mut self, usdc: u64) -> (Keypair, Pubkey) {
        let u = Keypair::new();
        self.svm.airdrop(&u.pubkey(), 10_000_000_000).unwrap();
        let ta = Pubkey::new_unique();
        self.token_account(ta, u.pubkey(), usdc);
        (u, ta)
    }

    pub fn token_account(&mut self, at: Pubkey, owner: Pubkey, amount: u64) {
        let mut data = vec![0u8; spl_token::state::Account::LEN];
        spl_token::state::Account {
            mint: self.mint,
            owner,
            amount,
            delegate: None.into(),
            state: spl_token::state::AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.put(at, data, spl_token::ID);
    }

    pub fn balance(&self, ta: &Pubkey) -> u64 {
        spl_token::state::Account::unpack(&self.svm.get_account(ta).unwrap().data).unwrap().amount
    }

    pub fn state(&self) -> State {
        let a = self.svm.get_account(&state_pda()).unwrap();
        *bytemuck::from_bytes::<State>(&a.data[8..8 + std::mem::size_of::<State>()])
    }

    pub fn config(&self) -> Config {
        let a = self.svm.get_account(&config_pda()).unwrap();
        *bytemuck::from_bytes::<Config>(&a.data[8..8 + std::mem::size_of::<Config>()])
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, secs: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp += secs;
        c.slot += 1;
        self.svm.set_sysvar(&c);
    }

    pub fn deposit(&mut self, u: &Keypair, ta: Pubkey, amount: u64) -> Result<(), String> {
        let ix = self.deposit_ix(&u.pubkey(), ta, amount);
        self.send(&[ix], &[u])
    }

    pub fn deposit_ix(&self, u: &Pubkey, ta: Pubkey, amount: u64) -> Instruction {
        let accounts = score::accounts::Deposit {
            user: *u,
            config: config_pda(),
            state: state_pda(),
            pending: self.pending,
            user_usdc: ta,
            custody: custody_pda(),
            usdc_mint: self.mint,
            token_program: spl_token::ID,
        };
        ix(accounts, score::instruction::Deposit { amount })
    }

    pub fn init_page(&mut self, id: u64) {
        let accounts = score::accounts::InitVoucherPage { payer: self.admin.pubkey(), page: page_pda(id), system_program: anchor_lang::solana_program::system_program::ID };
        let admin = self.admin.insecure_clone();
        let _ = self.send(&[ix(accounts, score::instruction::InitVoucherPage { index: id / PAGE_BITS })], &[&admin]);
    }

    pub fn withdraw_ixs(&self, u: &Pubkey, ta: Pubkey, amount: u64, id: u64, expiry: i64, key: &SigningKey) -> Vec<Instruction> {
        let msg = voucher_message(&score::ID, u, amount, id, expiry);
        let accounts = score::accounts::Withdraw {
            user: *u,
            config: config_pda(),
            state: state_pda(),
            pending: self.pending,
            page: page_pda(id),
            user_usdc: ta,
            custody: custody_pda(),
            custody_auth: custody_auth_pda(),
            usdc_mint: self.mint,
            instructions: Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111"),
            token_program: spl_token::ID,
        };
        vec![ed25519_ix(key, &msg), ix(accounts, score::instruction::Withdraw { amount, id, expiry })]
    }

    pub fn withdraw(&mut self, u: &Keypair, ta: Pubkey, amount: u64, id: u64) -> Result<(), String> {
        self.init_page(id);
        let expiry = self.now() + 60;
        let ixs = self.withdraw_ixs(&u.pubkey(), ta, amount, id, expiry, &self.voucher.clone());
        self.send(&ixs, &[u])
    }

    /// A batch consuming everything on-chain so far, with the given roots and engine figures
    /// (vault figure 0; set `vault` on the result to sweep the vault).
    pub fn batch(&self, state_root: [u8; 32], exit_root: [u8; 32], liabilities: u64, treasury: u64) -> Batch {
        let s = self.state();
        Batch {
            seq: s.batch_seq + 1,
            prev_state_root: s.state_root,
            state_root,
            exit_root,
            log_head: [9; 32],
            deposits: s.deposit_count,
            deposit_hash: s.deposit_hash,
            payouts: s.payout_count,
            payout_hash: s.payout_hash,
            forced_served: s.forced_served,
            liabilities,
            vault: 0,
            treasury,
        }
    }

    pub fn commit(&mut self, b: Batch, signer: &Keypair) -> Result<(), String> {
        let i = self.commit_ix(b, &signer.pubkey());
        self.send(&[i], &[signer])
    }

    pub fn commit_ix(&self, b: Batch, operator: &Pubkey) -> Instruction {
        let accounts = score::accounts::CommitBatch {
            operator: *operator,
            config: config_pda(),
            state: state_pda(),
            custody: custody_pda(),
            custody_auth: custody_auth_pda(),
            vault: vault_pda(),
            vault_auth: vault_auth_pda(),
            treasury: treasury_pda(),
            usdc_mint: self.mint,
            token_program: spl_token::ID,
        };
        ix(accounts, score::instruction::CommitBatch { b })
    }

    pub fn custody_balance(&self) -> u64 {
        self.balance(&custody_pda())
    }

    /// Record a voucher withdrawal as a request (the above-the-cap path). Rent paid by the admin.
    pub fn request(&mut self, u: &Keypair, amount: u64, id: u64) -> Result<(), String> {
        self.init_page(id);
        let expiry = self.now() + 60;
        let msg = voucher_message(&score::ID, &u.pubkey(), amount, id, expiry);
        let accounts = score::accounts::RequestWithdrawal {
            payer: self.admin.pubkey(),
            user: u.pubkey(),
            config: config_pda(),
            state: state_pda(),
            page: page_pda(id),
            withdraw_request: request_pda(id),
            instructions: Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111"),
            system_program: anchor_lang::solana_program::system_program::ID,
        };
        let (admin, key) = (self.admin.insecure_clone(), self.voucher.clone());
        self.send(&[ed25519_ix(&key, &msg), ix(accounts, score::instruction::RequestWithdrawal { amount, id, expiry })], &[&admin, u])
    }

    pub fn settle_ix(&self, id: u64, user_usdc: Pubkey) -> Instruction {
        ix(
            score::accounts::SettleRequest {
                config: config_pda(),
                state: state_pda(),
                pending: self.pending,
                withdraw_request: request_pda(id),
                rent_to: self.admin.pubkey(),
                user_usdc,
                custody: custody_pda(),
                custody_auth: custody_auth_pda(),
                usdc_mint: self.mint,
                token_program: spl_token::ID,
                operator: None,
            },
            score::instruction::SettleRequest {},
        )
    }

    /// Wait out the liveness deadline and switch on exit mode.
    pub fn enter_exit_mode(&mut self) {
        self.warp(self.config().limits.liveness_deadline + 1);
        let enter = ix(score::accounts::EnterExitMode { config: config_pda(), state: state_pda(), oldest: None }, score::instruction::EnterExitMode {});
        let admin = self.admin.insecure_clone();
        self.send(&[enter], &[&admin]).unwrap();
    }

    /// `exit_withdraw` for `who`, with the voucher page and request PDA of each lock attached.
    pub fn exit_ix(&self, who: &Pubkey, ta: Pubkey, usdc: u64, locks: &[(u64, u64)], proof: Vec<([u8; 32], bool)>) -> Instruction {
        let mut i = ix(
            score::accounts::ExitWithdraw {
                user: *who,
                payer: *who,
                config: config_pda(),
                state: state_pda(),
                pending: self.pending,
                marker: pda(&[EXITED_SEED, who.as_ref()]),
                user_usdc: ta,
                custody: custody_pda(),
                custody_auth: custody_auth_pda(),
                usdc_mint: self.mint,
                token_program: spl_token::ID,
                system_program: anchor_lang::solana_program::system_program::ID,
            },
            score::instruction::ExitWithdraw {
                usdc,
                locks: locks.iter().map(|(id, amount)| ExitLock { id: *id, amount: *amount }).collect(),
                proof: proof.into_iter().map(|(sibling, right)| ProofNode { sibling, right }).collect(),
            },
        );
        for (id, _) in locks {
            i.accounts.push(AccountMeta::new(page_pda(*id), false));
            i.accounts.push(AccountMeta::new(request_pda(*id), false));
        }
        i
    }

    pub fn exit(&mut self, who: &Keypair, ta: Pubkey, usdc: u64, locks: &[(u64, u64)], proof: Vec<([u8; 32], bool)>) -> Result<(), String> {
        let i = self.exit_ix(&who.pubkey(), ta, usdc, locks, proof);
        self.send(&[i], &[who])
    }
}

pub fn request_pda(id: u64) -> Pubkey {
    pda(&[REQUEST_SEED, &id.to_le_bytes()])
}

/// A real engine that mirrors the chain, for exit tables built the way production builds them.
pub struct Mirror {
    pub seq: score_engine::wal::Sequencer,
    pub deposits: u64,
    nonces: std::collections::BTreeMap<Pubkey, u64>,
}

impl Mirror {
    pub fn new() -> Self {
        Mirror { seq: score_engine::wal::Sequencer::new(), deposits: 0, nonces: Default::default() }
    }

    pub fn deposit(&mut self, u: &Pubkey, amount: u64) {
        self.deposits += 1;
        self.seq.submit(self.seq.last_ts.max(1), score_engine::Cmd::Deposit { user: u.to_bytes(), amount, seq: self.deposits }, None).unwrap();
    }

    /// The user locks `amount` for voucher `id` (signed by the user, as in production).
    pub fn lock(&mut self, u: &Keypair, amount: u64, id: u64) {
        let n = self.nonces.entry(u.pubkey()).or_default();
        *n += 1;
        let c = score_engine::Cmd::LockWithdraw { user: u.pubkey().to_bytes(), nonce: *n, amount, id, expiry: i64::MAX / 2 };
        let sig: [u8; 64] = u.sign_message(&score_engine::auth::order_message(&c)).as_ref().try_into().unwrap();
        self.seq.submit(self.seq.last_ts.max(2), c, Some(sig)).unwrap();
    }

    /// A user-signed engine command (the nonce is filled in).
    pub fn signed(&mut self, ts: i64, u: &Keypair, f: impl FnOnce(u64) -> score_engine::Cmd) -> score_engine::Outcome {
        let n = self.nonces.entry(u.pubkey()).or_default();
        *n += 1;
        let c = f(*n);
        let sig: [u8; 64] = u.sign_message(&score_engine::auth::order_message(&c)).as_ref().try_into().unwrap();
        self.seq.submit(ts.max(self.seq.last_ts), c, Some(sig)).unwrap().0
    }

    pub fn system(&mut self, ts: i64, c: score_engine::Cmd) -> Result<score_engine::Outcome, score_engine::Error> {
        self.seq.submit(ts.max(self.seq.last_ts), c, None).map(|r| r.0)
    }

    /// The watcher reports a finalized voucher payout (in the program's payout order).
    pub fn paid(&mut self, id: u64) {
        let seq = self.seq.engine.payouts() + 1;
        self.seq.submit(self.seq.last_ts.max(3), score_engine::Cmd::WithdrawPaid { id, seq }, None).unwrap();
    }

    /// Commit a batch with this engine's state, exit root and liabilities.
    pub fn commit(&self, t: &mut T) {
        self.seq.engine.check_invariants().unwrap();
        let e = &self.seq.engine;
        let b = t.batch(score_engine::state_root::state_root(e), score_engine::exit::exit_root(e).unwrap(), e.custody(), e.treasury());
        // The cuts are the engine's own counts of what it has applied, as the committer reports them.
        let s = t.state();
        let payout_hash = State::lookup(&s.payout_ring, (s.payout_count, s.payout_total, s.payout_hash), e.payouts()).unwrap().1;
        let b = Batch {
            deposits: e.deposits(),
            deposit_hash: t.state_hash_at_deposit(e.deposits()),
            payouts: e.payouts(),
            payout_hash,
            vault: e.vault(),
            ..b
        };
        let op = t.operator.insecure_clone();
        t.commit(b, &op).unwrap();
    }

    /// The user's committed exit entry and proof.
    #[allow(clippy::type_complexity)]
    pub fn leaf(&self, u: &Pubkey) -> (u64, Vec<(u64, u64)>, Vec<([u8; 32], bool)>) {
        let table = score_engine::exit::exit_table(&self.seq.engine).unwrap();
        let (e, p) = score_engine::exit::exit_proof(&table, &u.to_bytes()).unwrap();
        (e.usdc, e.locks, p)
    }
}

impl T {
    /// The on-chain deposit chain hash after `count` deposits (from the ring).
    pub fn state_hash_at_deposit(&self, count: u64) -> [u8; 32] {
        let s = self.state();
        State::lookup(&s.deposit_ring, (s.deposit_count, s.deposit_total, s.deposit_hash), count).unwrap().1
    }
}

pub fn err_has(r: Result<(), String>, what: &str) {
    let e = r.expect_err(&format!("expected failure with {what}"));
    assert!(e.contains(what), "expected {what}, got {e}");
}

