//! Signature introspection, hash chains and Merkle proofs. Byte formats here are a contract with
//! the engine (`score-engine`): change them only together.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sha256_hasher::hashv;

use crate::error::ScoreError;
use crate::state::{ExitLock, ProofNode};

pub const VOUCHER_DOMAIN: &[u8] = b"score:voucher:v1:";
pub const DEPOSIT_DOMAIN: &[u8] = b"score:deposit:v1:";
pub const PAYOUT_DOMAIN: &[u8] = b"score:payout:v1:";

/// The exact bytes the engine signs for a voucher. Binding the program id prevents replay
/// against another deployment.
pub fn voucher_message(program: &Pubkey, user: &Pubkey, amount: u64, id: u64, expiry: i64) -> Vec<u8> {
    let mut m = Vec::with_capacity(VOUCHER_DOMAIN.len() + 88);
    m.extend_from_slice(VOUCHER_DOMAIN);
    m.extend_from_slice(program.as_ref());
    m.extend_from_slice(user.as_ref());
    m.extend_from_slice(&amount.to_le_bytes());
    m.extend_from_slice(&id.to_le_bytes());
    m.extend_from_slice(&expiry.to_le_bytes());
    m
}

/// Require that the instruction right before this one is an Ed25519 program instruction verifying
/// exactly one signature by `signer` over exactly `message`, with all data inside that instruction.
///
/// The runtime has already verified the signature if the transaction got this far; what must be
/// checked here is *what* was verified. Known pitfalls handled: offsets that point into another
/// instruction's data (all instruction indexes must be u16::MAX = "this instruction"), more than
/// one signature, out-of-bounds offsets, and a different program masquerading as Ed25519.
pub fn check_ed25519(ix_sysvar: &AccountInfo, signer: &Pubkey, message: &[u8]) -> Result<()> {
    let cur = load_current_index_checked(ix_sysvar)? as usize;
    require!(cur > 0, ScoreError::MissingSignature);
    let ix = load_instruction_at_checked(cur - 1, ix_sysvar)?;
    require!(ix.program_id.to_bytes() == solana_sdk_ids::ed25519_program::ID.to_bytes(), ScoreError::MissingSignature);
    require!(ix.accounts.is_empty(), ScoreError::BadSignature);
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, ScoreError::BadSignature);
    let rd = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]);
    let (sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix) = (rd(2), rd(4), rd(6), rd(8), rd(10), rd(12), rd(14));
    require!(sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX, ScoreError::BadSignature);
    let get = |o: u16, n: usize| d.get(o as usize..(o as usize).checked_add(n)?);
    let pk = get(pk_off, 32).ok_or(ScoreError::BadSignature)?;
    get(sig_off, 64).ok_or(ScoreError::BadSignature)?;
    let msg = get(msg_off, msg_len as usize).ok_or(ScoreError::BadSignature)?;
    require!(pk == signer.as_ref(), ScoreError::BadSignature);
    require!(msg == message, ScoreError::BadSignature);
    Ok(())
}

pub fn deposit_link(prev: &[u8; 32], count: u64, user: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[DEPOSIT_DOMAIN, prev, &count.to_le_bytes(), user.as_ref(), &amount.to_le_bytes()]).to_bytes()
}

pub fn payout_link(prev: &[u8; 32], count: u64, kind: u8, id: u64, to: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[PAYOUT_DOMAIN, prev, &count.to_le_bytes(), &[kind], &id.to_le_bytes(), to.as_ref(), &amount.to_le_bytes()]).to_bytes()
}

/// Exit leaf, identical to `score_engine::exit::exit_leaf`:
/// sha256(0x00 || "exit" || user || usdc u64 LE || n u32 LE || (id u64 LE || amount u64 LE)*).
pub fn exit_leaf(user: &Pubkey, usdc: u64, locks: &[ExitLock]) -> [u8; 32] {
    let mut body = Vec::with_capacity(12 + 16 * locks.len());
    body.extend_from_slice(&usdc.to_le_bytes());
    body.extend_from_slice(&(locks.len() as u32).to_le_bytes());
    for l in locks {
        body.extend_from_slice(&l.id.to_le_bytes());
        body.extend_from_slice(&l.amount.to_le_bytes());
    }
    hashv(&[&[0u8], b"exit", user.as_ref(), &body]).to_bytes()
}

/// Merkle path check; node = sha256(0x01 || left || right), as in `score_engine::state_root`.
pub fn verify_proof(root: &[u8; 32], leaf: [u8; 32], path: &[ProofNode]) -> bool {
    let mut h = leaf;
    for n in path {
        h = if n.right { hashv(&[&[1u8], &h, &n.sibling]) } else { hashv(&[&[1u8], &n.sibling, &h]) }.to_bytes();
    }
    h == *root
}
