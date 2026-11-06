//! Program accounts, instructions and events, via the program crate's own types.

use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use score::constants::*;
use score::state::{Config, ForcedRequest, State, VoucherPage, WithdrawRequest};
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;

pub const TOKEN_PROGRAM: Pubkey = solana_sdk::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM: Pubkey = solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const COMPUTE_BUDGET: Pubkey = solana_sdk::pubkey!("ComputeBudget111111111111111111111111111111");
pub const ED25519_PROGRAM: Pubkey = solana_sdk::pubkey!("Ed25519SigVerify111111111111111111111111111");

pub fn program_id() -> Pubkey {
    score::ID
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &score::ID).0
}

#[derive(Debug, Clone, Copy)]
pub struct Addrs {
    pub config: Pubkey,
    pub state: Pubkey,
    pub custody: Pubkey,
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub pending: Pubkey,
    pub usdc_mint: Pubkey,
}

impl Addrs {
    pub fn from_config(c: &Config) -> Self {
        Addrs { config: CONFIG_ADDRESS, state: STATE_ADDRESS, custody: c.custody, vault: c.vault, treasury: c.treasury, pending: c.pending, usdc_mint: c.usdc_mint }
    }
}

pub fn page_address(id: u64) -> Pubkey {
    pda(&[PAGE_SEED, &(id / PAGE_BITS).to_le_bytes()])
}

pub fn request_address(id: u64) -> Pubkey {
    pda(&[REQUEST_SEED, &id.to_le_bytes()])
}

pub fn forced_address(index: u64) -> Pubkey {
    pda(&[FORCE_SEED, &index.to_le_bytes()])
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}


fn zero_copy<T: bytemuck::Pod>(data: &[u8]) -> anyhow::Result<T> {
    let size = std::mem::size_of::<T>();
    anyhow::ensure!(data.len() >= 8 + size, "account too short");
    Ok(*bytemuck::from_bytes::<T>(&data[8..8 + size]))
}

pub fn decode_config(data: &[u8]) -> anyhow::Result<Config> {
    zero_copy(data)
}
pub fn decode_state(data: &[u8]) -> anyhow::Result<State> {
    zero_copy(data)
}
pub fn decode_page(data: &[u8]) -> anyhow::Result<VoucherPage> {
    zero_copy(data)
}
pub fn decode_request(data: &[u8]) -> anyhow::Result<WithdrawRequest> {
    Ok(WithdrawRequest::try_deserialize(&mut &data[..])?)
}
pub fn decode_forced(data: &[u8]) -> anyhow::Result<ForcedRequest> {
    Ok(ForcedRequest::try_deserialize(&mut &data[..])?)
}
/// (mint, owner) of an SPL token account.
pub fn token_account_owner(data: &[u8]) -> Option<(Pubkey, Pubkey)> {
    (data.len() >= 72).then(|| (Pubkey::new_from_array(data[..32].try_into().unwrap()), Pubkey::new_from_array(data[32..64].try_into().unwrap())))
}

/// (total, hash) of a chain at `count`, from the program's own ring lookup.
pub fn deposit_cut(st: &State, count: u64) -> Option<[u8; 32]> {
    State::lookup(&st.deposit_ring, (st.deposit_count, st.deposit_total, st.deposit_hash), count).map(|x| x.1)
}
pub fn payout_cut(st: &State, count: u64) -> Option<[u8; 32]> {
    State::lookup(&st.payout_ring, (st.payout_count, st.payout_total, st.payout_hash), count).map(|x| x.1)
}


fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: score::ID,
        accounts: accounts.to_account_metas(None).into_iter().map(|m| AccountMeta { pubkey: m.pubkey, is_signer: m.is_signer, is_writable: m.is_writable }).collect(),
        data: data.data(),
    }
}

pub fn commit_batch(a: &Addrs, operator: Pubkey, b: score::state::Batch) -> Instruction {
    ix(
        score::accounts::CommitBatch {
            operator,
            config: a.config,
            state: a.state,
            custody: a.custody,
            custody_auth: CUSTODY_AUTH_ADDRESS,
            vault: a.vault,
            vault_auth: VAULT_AUTH_ADDRESS,
            treasury: a.treasury,
            usdc_mint: a.usdc_mint,
            token_program: TOKEN_PROGRAM,
        },
        score::instruction::CommitBatch { b },
    )
}

pub fn settle_request(a: &Addrs, id: u64, user: Pubkey, rent_to: Pubkey, operator: Pubkey) -> Instruction {
    ix(
        score::accounts::SettleRequest {
            config: a.config,
            state: a.state,
            pending: a.pending,
            withdraw_request: request_address(id),
            rent_to,
            user_usdc: ata(&user, &a.usdc_mint),
            custody: a.custody,
            custody_auth: CUSTODY_AUTH_ADDRESS,
            usdc_mint: a.usdc_mint,
            token_program: TOKEN_PROGRAM,
            operator: Some(operator),
        },
        score::instruction::SettleRequest {},
    )
}

/// Answer forced request `index`; `pay_to` is the user's USDC account when `amount` > 0.
pub fn serve_forced(a: &Addrs, index: u64, user: Pubkey, pay_to: Option<Pubkey>, amount: u64, operator: Pubkey) -> Instruction {
    ix(
        score::accounts::ServeForced {
            operator,
            config: a.config,
            state: a.state,
            pending: a.pending,
            forced_request: forced_address(index),
            user,
            user_usdc: pay_to,
            custody: a.custody,
            custody_auth: CUSTODY_AUTH_ADDRESS,
            usdc_mint: a.usdc_mint,
            token_program: TOKEN_PROGRAM,
        },
        score::instruction::ServeForced { index, amount },
    )
}

pub fn init_voucher_page(payer: Pubkey, index: u64) -> Instruction {
    ix(
        score::accounts::InitVoucherPage { payer, page: pda(&[PAGE_SEED, &index.to_le_bytes()]), system_program: solana_sdk::pubkey!("11111111111111111111111111111111") },
        score::instruction::InitVoucherPage { index },
    )
}

pub fn compute_budget(limit: u32, micro_lamports: u64) -> [Instruction; 2] {
    let mut l = vec![2u8];
    l.extend_from_slice(&limit.to_le_bytes());
    let mut p = vec![3u8];
    p.extend_from_slice(&micro_lamports.to_le_bytes());
    [Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data: l }, Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data: p }]
}

/// Instruction discriminators the relayer will pay for.
pub fn disc_deposit() -> &'static [u8] {
    score::instruction::Deposit::DISCRIMINATOR
}
pub fn disc_withdraw() -> &'static [u8] {
    score::instruction::Withdraw::DISCRIMINATOR
}
pub fn disc_request() -> &'static [u8] {
    score::instruction::RequestWithdrawal::DISCRIMINATOR
}


#[derive(Debug, Clone)]
pub enum Event {
    Deposited { seq: u64, user: Pubkey, amount: u64 },
    Paid { seq: u64, kind: u8, id: u64, amount: u64 },
    Requested { id: u64 },
    Forced { index: u64, user: Pubkey, kind: u8, data: [u8; 32] },
    ForcedServed { index: u64, amount: u64 },
    BatchCommitted,
    ExitMode,
}

/// Our program's events in a transaction's logs ("Program data: <base64>").
pub fn parse_events(logs: &[String]) -> Vec<Event> {
    use base64::Engine as _;
    let mut out = Vec::new();
    for line in logs {
        let Some(b64) = line.strip_prefix("Program data: ") else { continue };
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) else { continue };
        if bytes.len() < 8 {
            continue;
        }
        let (disc, mut body) = bytes.split_at(8);
        if disc == score::events::Deposited::DISCRIMINATOR {
            if let Ok(e) = score::events::Deposited::deserialize(&mut body) {
                out.push(Event::Deposited { seq: e.seq, user: e.user, amount: e.amount });
            }
        } else if disc == score::events::Paid::DISCRIMINATOR {
            if let Ok(e) = score::events::Paid::deserialize(&mut body) {
                out.push(Event::Paid { seq: e.seq, kind: e.kind, id: e.id, amount: e.amount });
            }
        } else if disc == score::events::WithdrawalRequested::DISCRIMINATOR {
            if let Ok(e) = score::events::WithdrawalRequested::deserialize(&mut body) {
                out.push(Event::Requested { id: e.id });
            }
        } else if disc == score::events::ForceRequested::DISCRIMINATOR {
            if let Ok(e) = score::events::ForceRequested::deserialize(&mut body) {
                out.push(Event::Forced { index: e.index, user: e.user, kind: e.kind, data: e.data });
            }
        } else if disc == score::events::ForcedServed::DISCRIMINATOR {
            if let Ok(e) = score::events::ForcedServed::deserialize(&mut body) {
                out.push(Event::ForcedServed { index: e.index, amount: e.amount });
            }
        } else if disc == score::events::BatchCommitted::DISCRIMINATOR {
            if let Ok(e) = score::events::BatchCommitted::deserialize(&mut body) {
                let _ = e;
                out.push(Event::BatchCommitted);
            }
        } else if disc == score::events::ExitModeEntered::DISCRIMINATOR {
            out.push(Event::ExitMode);
        }
    }
    out
}

pub fn voucher_message(user: &Pubkey, amount: u64, id: u64, expiry: i64) -> Vec<u8> {
    score::verify::voucher_message(&score::ID, user, amount, id, expiry)
}

pub const PAYOUT_VOUCHER_KIND: u8 = PAYOUT_VOUCHER;
pub const PAYOUT_TREASURY_KIND: u8 = PAYOUT_TREASURY;
pub const PAGE_BITS_: u64 = PAGE_BITS;
pub const FORCED_ID_BIT_: u64 = FORCED_ID_BIT;
pub const PAUSE_DEPOSITS_: u8 = PAUSE_DEPOSITS;
pub const PAUSE_WITHDRAWALS_: u8 = PAUSE_WITHDRAWALS;
