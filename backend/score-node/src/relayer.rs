//! Relayer: pays the fee on users' transactions, so users never need SOL. Co-signs only if: no lookup
//! tables; it is the fee payer; every other signature is valid; only capped compute-budget plus one of
//! two shapes:
//! - Our program: Ed25519 and exactly one of deposit / withdraw / request_withdrawal. The relayer
//!   appears in no instruction (except as `request_withdrawal`'s refunded rent payer).
//! - A wallet send: one test-USDC `TransferChecked` out of the signer's own token account (at least
//!   `MIN_SEND`), optionally preceded by one idempotent create of the recipient's token account, which
//!   the relayer funds (the only place it may appear). Rate-limited by the API.

use anyhow::{bail, ensure, Result};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::VersionedTransaction;

use crate::program;

pub const MAX_CU_LIMIT: u32 = 100_000;
pub const MAX_CU_PRICE: u64 = 200_000; // micro-lamports per CU
/// Smallest wallet send we pay the fee for (1 USDC): keeps fee spam expensive.
pub const MIN_SEND: u64 = 1_000_000;
const TRANSFER_CHECKED: u8 = 12;
const ATA_CREATE_IDEMPOTENT: u8 = 1;
const SYSTEM_PROGRAM: Pubkey = solana_sdk::pubkey!("11111111111111111111111111111111");

/// What a relayed transaction does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Deposit,
    Withdraw,
    Request,
    /// A withdraw paid straight on to another address in the same transaction: custody → the user's
    /// token account → the destination. `creates` = the relayer funds the recipient's token account,
    /// the same rent it would pay for a send, so the API rate-limits it the same way.
    WithdrawTo { creates: bool },
    /// USDC from the user's wallet to another address. `creates` = the relayer funds the recipient's
    /// token account (≈0.002 SOL of rent), so the API rate-limits it.
    Send { user: Pubkey, creates: bool },
}

pub fn cosign(bytes: &[u8], relayer: &Keypair, usdc_mint: &Pubkey) -> Result<(VersionedTransaction, Kind)> {
    let mut tx: VersionedTransaction = bincode::deserialize(bytes)?;
    let msg = &tx.message;
    ensure!(msg.address_table_lookups().is_none_or(|l| l.is_empty()), "address lookup tables are not accepted");
    let keys = msg.static_account_keys();
    ensure!(!keys.is_empty() && keys[0] == relayer.pubkey(), "fee payer must be the relayer");
    let n_sig = msg.header().num_required_signatures as usize;
    ensure!(tx.signatures.len() == n_sig && n_sig >= 2, "expected the relayer's and the user's signatures");
    ensure!(msg.instructions().len() <= 6, "too many instructions");

    let mut program_ixs = 0;
    // Index of the withdraw and of the transfer in the message: the transfer must come after the
    // withdraw that funds it.
    let mut withdrew = false;
    let mut withdraw_at = usize::MAX;
    let mut transfer_at = usize::MAX;
    let mut kind = Kind::Deposit;
    let mut transfers: Vec<Pubkey> = Vec::new();
    let mut created: Vec<Pubkey> = Vec::new();
    let key = |i: u8| -> Result<Pubkey> { keys.get(i as usize).copied().ok_or_else(|| anyhow::anyhow!("bad account index")) };
    for (at, ix) in msg.instructions().iter().enumerate() {
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
                if d == program::disc_withdraw() {
                    withdrew = true;
                    withdraw_at = at;
                }
            } else {
                bail!("program instruction not allowed");
            }
        } else if program_id == program::TOKEN_PROGRAM {
            // TransferChecked: [source, mint, destination, authority], data = 12 · amount u64 · decimals u8.
            ensure!(ix.data.len() == 10 && ix.data[0] == TRANSFER_CHECKED, "only TransferChecked is allowed");
            ensure!(uses_relayer.is_none(), "a transfer can't touch the relayer");
            ensure!(ix.accounts.len() == 4, "TransferChecked takes 4 accounts");
            let (source, mint, dest, authority) = (key(ix.accounts[0])?, key(ix.accounts[1])?, key(ix.accounts[2])?, key(ix.accounts[3])?);
            ensure!(mint == *usdc_mint && ix.data[9] == 6, "only test USDC can be sent");
            ensure!(n_sig == 2 && ix.accounts[3] == 1, "the transfer must be signed by the user");
            ensure!(source == program::ata(&authority, usdc_mint), "the transfer must come from the user's own USDC account");
            ensure!(dest != source, "can't send to yourself");
            ensure!(u64::from_le_bytes(ix.data[1..9].try_into()?) >= MIN_SEND, "sends start at 1 USDC");
            transfers.push(dest);
            transfer_at = at;
        } else if program_id == program::ATA_PROGRAM {
            // CreateIdempotent: [funding, account, owner, mint, system, token]; the relayer funds it.
            ensure!(ix.data == [ATA_CREATE_IDEMPOTENT], "only an idempotent token-account create is allowed");
            ensure!(ix.accounts.len() == 6 && ix.accounts[0] == 0 && ix.accounts.iter().filter(|a| **a == 0).count() == 1, "the relayer may only fund the account");
            let (ata, owner, mint) = (key(ix.accounts[1])?, key(ix.accounts[2])?, key(ix.accounts[3])?);
            ensure!(mint == *usdc_mint && ata == program::ata(&owner, usdc_mint), "only a test-USDC account for its owner");
            ensure!(key(ix.accounts[4])? == SYSTEM_PROGRAM && key(ix.accounts[5])? == program::TOKEN_PROGRAM, "wrong programs in the create");
            created.push(ata);
        } else {
            bail!("program {program_id} not allowed");
        }
    }
    if transfers.is_empty() && created.is_empty() {
        ensure!(program_ixs == 1, "exactly one score instruction per transaction");
    } else if program_ixs == 1 && withdrew {
        // Withdraw straight out to another address, in one transaction: the program pays custody → the
        // user's own token account, then the transfer moves it on to the destination. Instructions run in
        // order, so the funds are there before the transfer; if either fails the whole transaction
        // reverts. Roughly 600 bytes of message, well inside the 1,232-byte legacy limit.
        ensure!(transfers.len() == 1 && created.len() <= 1, "one transfer per withdrawal, and at most one account create");
        ensure!(created.iter().all(|c| *c == transfers[0]), "the created account must be the recipient's");
        ensure!(
            withdraw_at < transfer_at,
            "the withdrawal must come before the transfer that spends it"
        );
        kind = Kind::WithdrawTo { creates: !created.is_empty() };
    } else {
        ensure!(program_ixs == 0, "a wallet send can't include score instructions");
        ensure!(transfers.len() == 1 && created.len() <= 1, "one transfer per send, and at most one account create");
        ensure!(created.iter().all(|c| *c == transfers[0]), "the created account must be the recipient's");
        ensure!(!msg.instructions().iter().any(|ix| keys.get(ix.program_id_index as usize) == Some(&program::ED25519_PROGRAM)), "no signature checks in a send");
        kind = Kind::Send { user: keys[1], creates: !created.is_empty() };
    }

    let data = msg.serialize();
    for (i, (sig, key)) in tx.signatures.iter().zip(keys).enumerate().skip(1) {
        ensure!(sig.verify(key.as_ref(), &data), "signature {i} is missing or invalid");
    }
    tx.signatures[0] = relayer.sign_message(&data);
    Ok((tx, kind))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::instruction::{AccountMeta, Instruction};
    use solana_sdk::message::{Message, VersionedMessage};

    fn send_ixs(user: &Pubkey, to: &Pubkey, mint: &Pubkey, relayer: &Pubkey, amount: u64, create: bool) -> Vec<Instruction> {
        let (src, dst) = (program::ata(user, mint), program::ata(to, mint));
        let mut ixs = vec![];
        if create {
            ixs.push(Instruction {
                program_id: program::ATA_PROGRAM,
                accounts: vec![AccountMeta::new(*relayer, true), AccountMeta::new(dst, false), AccountMeta::new_readonly(*to, false), AccountMeta::new_readonly(*mint, false), AccountMeta::new_readonly(SYSTEM_PROGRAM, false), AccountMeta::new_readonly(program::TOKEN_PROGRAM, false)],
                data: vec![ATA_CREATE_IDEMPOTENT],
            });
        }
        let mut data = vec![TRANSFER_CHECKED];
        data.extend_from_slice(&amount.to_le_bytes());
        data.push(6);
        ixs.push(Instruction {
            program_id: program::TOKEN_PROGRAM,
            accounts: vec![AccountMeta::new(src, false), AccountMeta::new_readonly(*mint, false), AccountMeta::new(dst, false), AccountMeta::new_readonly(*user, true)],
            data,
        });
        ixs
    }

    fn wire(ixs: &[Instruction], relayer: &Keypair, user: &Keypair) -> Vec<u8> {
        let msg = Message::new(ixs, Some(&relayer.pubkey()));
        let n = msg.header.num_required_signatures as usize;
        let needed: Vec<&Keypair> = [relayer, user].into_iter().filter(|k| msg.account_keys[..n].contains(&k.pubkey())).collect();
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &needed).unwrap();
        bincode::serialize(&tx).unwrap()
    }

    #[test]
    fn wallet_send_is_cosigned_only_in_its_exact_shape() {
        let (relayer, user, other) = (Keypair::new(), Keypair::new(), Keypair::new());
        let mint = Pubkey::new_unique();
        let to = Pubkey::new_unique();
        let ok = |ixs: Vec<Instruction>| cosign(&wire(&ixs, &relayer, &user), &relayer, &mint);

        let (_, kind) = ok(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, true)).unwrap();
        assert_eq!(kind, Kind::Send { user: user.pubkey(), creates: true });
        let (_, kind) = ok(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), MIN_SEND, false)).unwrap();
        assert_eq!(kind, Kind::Send { user: user.pubkey(), creates: false });

        // Below the minimum; another mint; from someone else's account; the relayer's own USDC.
        assert!(ok(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), MIN_SEND - 1, false)).is_err());
        assert!(ok(send_ixs(&user.pubkey(), &to, &Pubkey::new_unique(), &relayer.pubkey(), 5_000_000, false)).is_err());
        let mut steal = send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false);
        steal[0].accounts[0] = AccountMeta::new(program::ata(&other.pubkey(), &mint), false);
        assert!(ok(steal).is_err());
        assert!(ok(send_ixs(&relayer.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false)).is_err());
        // Two transfers; creating an account that isn't the recipient's.
        let mut two = send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false);
        two.extend(send_ixs(&user.pubkey(), &Pubkey::new_unique(), &mint, &relayer.pubkey(), 5_000_000, false));
        assert!(ok(two).is_err());
        let mut wrong = send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, true);
        wrong.truncate(1);
        wrong.extend(send_ixs(&user.pubkey(), &Pubkey::new_unique(), &mint, &relayer.pubkey(), 5_000_000, false));
        assert!(ok(wrong).is_err());
        // A plain SOL transfer out of the relayer is never signed.
        let mut data = 2u32.to_le_bytes().to_vec(); // system Transfer
        data.extend_from_slice(&1_000_000u64.to_le_bytes());
        let sol = Instruction { program_id: SYSTEM_PROGRAM, accounts: vec![AccountMeta::new(relayer.pubkey(), true), AccountMeta::new(user.pubkey(), false)], data };
        assert!(ok(vec![sol]).is_err());
    }

    /// A withdraw followed by the transfer that spends it, in one transaction: custody → the user's own
    /// token account → the destination. Order matters, and the send-only rules still apply to it.
    #[test]
    fn withdraw_paid_straight_on_is_one_transaction() {
        let (relayer, user) = (Keypair::new(), Keypair::new());
        let mint = Pubkey::new_unique();
        let to = Pubkey::new_unique();
        let withdraw = || Instruction {
            program_id: program::program_id(),
            accounts: vec![AccountMeta::new_readonly(user.pubkey(), true), AccountMeta::new_readonly(score::CUSTODY_AUTH_ADDRESS, false)],
            data: program::disc_withdraw().to_vec(),
        };
        let ok = |ixs: Vec<Instruction>| cosign(&wire(&ixs, &relayer, &user), &relayer, &mint);

        let mut one = vec![withdraw()];
        one.extend(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, true));
        let (_, kind) = ok(one).unwrap();
        assert_eq!(kind, Kind::WithdrawTo { creates: true });

        // The transfer first: the money it spends wouldn't be there yet.
        let mut backwards = send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false);
        backwards.push(withdraw());
        assert!(ok(backwards).is_err());

        // Two transfers, or a deposit instead of a withdraw, are not this shape.
        let mut two = vec![withdraw()];
        two.extend(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false));
        two.extend(send_ixs(&user.pubkey(), &Pubkey::new_unique(), &mint, &relayer.pubkey(), 5_000_000, false));
        assert!(ok(two).is_err());
        let mut deposit = vec![Instruction { program_id: program::program_id(), accounts: vec![AccountMeta::new_readonly(user.pubkey(), true)], data: program::disc_deposit().to_vec() }];
        deposit.extend(send_ixs(&user.pubkey(), &to, &mint, &relayer.pubkey(), 5_000_000, false));
        assert!(ok(deposit).is_err());
    }
}
