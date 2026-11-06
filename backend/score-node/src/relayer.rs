//! Relayer: pays the fee on users' deposit and withdrawal transactions, so users never need SOL.
//! It co-signs only transactions it can fully account for:
//! - no address lookup tables;
//! - the relayer is the fee payer (account 0) and appears in no instruction, except as the rent
//!   payer of `request_withdrawal` (refunded to it when the request is paid);
//! - instructions are only compute-budget (capped), the Ed25519 signature check, and our program's
//!   `deposit`, `withdraw` or `request_withdrawal`;
//! - every other required signature is present and valid.
//!
//! Then it adds its signature and sends with rebroadcast until finalized.

use anyhow::{bail, ensure, Result};
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::VersionedTransaction;

use crate::program;

pub const MAX_CU_LIMIT: u32 = 100_000;
pub const MAX_CU_PRICE: u64 = 200_000; // micro-lamports per CU

/// Which of our instructions a relayed transaction carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Deposit,
    Withdraw,
    Request,
}

pub fn cosign(bytes: &[u8], relayer: &Keypair) -> Result<(VersionedTransaction, Kind)> {
    let mut tx: VersionedTransaction = bincode::deserialize(bytes)?;
    let msg = &tx.message;
    ensure!(msg.address_table_lookups().is_none_or(|l| l.is_empty()), "address lookup tables are not accepted");
    let keys = msg.static_account_keys();
    ensure!(!keys.is_empty() && keys[0] == relayer.pubkey(), "fee payer must be the relayer");
    let n_sig = msg.header().num_required_signatures as usize;
    ensure!(tx.signatures.len() == n_sig && n_sig >= 2, "expected the relayer's and the user's signatures");
    ensure!(msg.instructions().len() <= 6, "too many instructions");

    let mut program_ixs = 0;
    let mut kind = Kind::Deposit;
    for ix in msg.instructions() {
        let program_id = *keys.get(ix.program_id_index as usize).ok_or_else(|| anyhow::anyhow!("bad program index"))?;
        let uses_relayer = ix.accounts.iter().position(|a| *a == 0);
        if program_id == program::COMPUTE_BUDGET {
            ensure!(uses_relayer.is_none(), "compute budget can't reference the relayer");
            match ix.data.first() {
                Some(2) => ensure!(ix.data.len() == 5 && u32::from_le_bytes(ix.data[1..5].try_into()?) <= MAX_CU_LIMIT, "compute limit too high"),
                Some(3) => ensure!(ix.data.len() == 9 && u64::from_le_bytes(ix.data[1..9].try_into()?) <= MAX_CU_PRICE, "priority fee too high"),
                _ => bail!("compute budget instruction not allowed"),
            }
        } else if program_id == program::ED25519_PROGRAM {
            ensure!(ix.accounts.is_empty(), "ed25519 instruction takes no accounts");
        } else if program_id == program::program_id() {
            let d = ix.data.get(..8).ok_or_else(|| anyhow::anyhow!("short instruction"))?;
            program_ixs += 1;
            if d == program::disc_request() {
                kind = Kind::Request;
                // The only place the relayer may appear: as the request's rent payer (account 0).
                ensure!(uses_relayer.is_none_or(|i| i == 0) && ix.accounts.iter().filter(|a| **a == 0).count() <= 1, "relayer misused in request_withdrawal");
            } else if d == program::disc_deposit() || d == program::disc_withdraw() {
                ensure!(uses_relayer.is_none(), "instruction references the relayer");
                kind = if d == program::disc_deposit() { Kind::Deposit } else { Kind::Withdraw };
            } else {
                bail!("program instruction not allowed");
            }
        } else {
            bail!("program {program_id} not allowed");
        }
    }
    ensure!(program_ixs == 1, "exactly one score instruction per transaction");

    let data = msg.serialize();
    for (i, (sig, key)) in tx.signatures.iter().zip(keys).enumerate().skip(1) {
        ensure!(sig.verify(key.as_ref(), &data), "signature {i} is missing or invalid");
    }
    tx.signatures[0] = relayer.sign_message(&data);
    Ok((tx, kind))
}
