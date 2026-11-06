//! Custody: deposits, voucher withdrawals (and attacks on them), the exposure cap, compute.
mod common;

use common::*;

#[test]
fn deposits_extend_the_on_chain_chain() {
    let mut t = T::new();
    let (a, ta) = t.user(500 * USDC);
    let (b, tb) = t.user(500 * USDC);
    t.deposit(&a, ta, 100 * USDC).unwrap();
    t.deposit(&b, tb, 250 * USDC).unwrap();
    let s = t.state();
    assert_eq!((s.deposit_count, s.deposit_total), (2, 350 * USDC));
    let h1 = deposit_link(&[0; 32], 1, &a.pubkey(), 100 * USDC);
    assert_eq!(s.deposit_hash, deposit_link(&h1, 2, &b.pubkey(), 250 * USDC));
    assert_eq!(t.custody_balance(), 350 * USDC);
    // Someone else's token account can't be the source (authority must be the signer).
    err_has(t.deposit(&a, tb, USDC), "ConstraintTokenOwner");
    err_has(t.deposit(&a, ta, 0), "ZeroAmount");
}

#[test]
fn voucher_withdrawal_is_instant_and_single_use() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    t.withdraw(&u, ta, 300 * USDC, 7).unwrap();
    assert_eq!(t.balance(&ta), 300 * USDC);
    assert_eq!(t.state().payout_count, 1);
    // Replaying the same voucher fails.
    err_has(t.withdraw(&u, ta, 300 * USDC, 7), "VoucherUsed");
}

#[test]
fn vouchers_resist_forgery_and_misuse() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    let (mallory, tm) = t.user(0);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    t.init_page(1);
    let now = t.now();
    let key = t.voucher.clone();
    // signed by the wrong key
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &SigningKey::from_bytes(&[5; 32]));
    err_has(t.send(&ixs, &[&u]), "BadSignature");
    // expired
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now - 1, &key);
    err_has(t.send(&ixs, &[&u]), "VoucherExpired");
    // valid far too long
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 10_000, &key);
    err_has(t.send(&ixs, &[&u]), "VoucherTooLong");
    // a different amount than signed
    let mut ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    ixs[1] = t.withdraw_ixs(&u.pubkey(), ta, 999 * USDC, 1, now + 60, &key)[1].clone();
    err_has(t.send(&ixs, &[&u]), "BadSignature");
    // mallory replays u's voucher for herself: the message names u, so it doesn't verify for her
    let mut ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    ixs[1] = t.withdraw_ixs(&mallory.pubkey(), tm, 10 * USDC, 1, now + 60, &key)[1].clone();
    err_has(t.send(&ixs, &[&mallory]), "BadSignature");
    // and she can't submit u's withdrawal without u's signature (to her own token account or not)
    let mut ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    ixs[1].accounts[0].is_signer = false;
    err_has(t.send(&ixs, &[&mallory]), "AccountNotSigner");
    let _ = tm;
    // no Ed25519 instruction
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    err_has(t.send(&ixs[1..], &[&u]), "MissingSignature");
    // Ed25519 instruction whose offsets point at another instruction's data
    let msg = voucher_message(&score::ID, &u.pubkey(), 10 * USDC, 1, now + 60);
    let real = ed25519_ix(&key, &msg);
    let mut sneaky = ed25519_ix_raw(&key.verifying_key().to_bytes(), &DalekSigner::sign(&key, &msg).to_bytes(), &msg, 0);
    sneaky.data = real.data.clone();
    for o in [4usize, 8, 14] {
        sneaky.data[o..o + 2].copy_from_slice(&0u16.to_le_bytes());
    }
    let mut ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    ixs.insert(0, real.clone());
    ixs[1] = sneaky;
    // The runtime accepts it (instruction 0 really carries a valid signature); our check must not.
    err_has(t.send(&ixs, &[&u]), "BadSignature");
    // the honest version still works
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 10 * USDC, 1, now + 60, &key);
    t.send(&ixs, &[&u]).unwrap();
    assert_eq!(t.balance(&ta), 10 * USDC);
}

#[test]
fn exposure_cap_then_request_settles_after_the_next_batch() {
    let mut t = T::with_limits(Limits { exposure_cap_min: 100 * USDC, exposure_cap_bps: 0, voucher_max_ttl: 300, forced_deadline: 86_400, liveness_deadline: 3 * 86_400 });
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    t.withdraw(&u, ta, 80 * USDC, 1).unwrap();
    err_has(t.withdraw(&u, ta, 30 * USDC, 2), "OverCap");
    // Record it instead.
    let now = t.now();
    let msg = voucher_message(&score::ID, &u.pubkey(), 30 * USDC, 2, now + 60);
    let req = pda(&[REQUEST_SEED, &2u64.to_le_bytes()]);
    let accounts = score::accounts::RequestWithdrawal {
        payer: t.admin.pubkey(),
        user: u.pubkey(),
        config: config_pda(),
        state: state_pda(),
        page: page_pda(2),
        withdraw_request: req,
        instructions: Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111"),
        system_program: anchor_lang::solana_program::system_program::ID,
    };
    let admin = t.admin.insecure_clone();
    let key = t.voucher.clone();
    t.send(&[ed25519_ix(&key, &msg), ix(accounts, score::instruction::RequestWithdrawal { amount: 30 * USDC, id: 2, expiry: now + 60 })], &[&admin, &u]).unwrap();
    let settle = |t: &T| {
        ix(
            score::accounts::SettleRequest {
                config: config_pda(),
                state: state_pda(),
                pending: t.pending,
                withdraw_request: req,
                rent_to: t.admin.pubkey(),
                user_usdc: ta,
                custody: custody_pda(),
                custody_auth: custody_auth_pda(),
                usdc_mint: t.mint,
                token_program: spl_token::ID,
                operator: None,
            },
            score::instruction::SettleRequest {},
        )
    };
    let s = settle(&t);
    err_has(t.send(&[s], &[&admin]), "NotYet");
    // A batch lands (engine liabilities = what's left in custody): exposure resets, request pays.
    let b = t.batch([1; 32], [2; 32], 920 * USDC, 0);
    let op = t.operator.insecure_clone();
    t.commit(b, &op).unwrap();
    let s = settle(&t);
    t.send(&[s], &[&admin]).unwrap();
    assert_eq!(t.balance(&ta), 110 * USDC);
    assert!(t.svm.get_account(&req).is_none_or(|a| a.lamports == 0), "request closed");
}

/// A single withdrawal larger than the cap: without the operator it can never be settled (the cap
/// check would always fail); with the operator's approval it is paid, and doesn't use up the cap.
#[test]
fn a_request_above_the_cap_needs_the_operator() {
    let mut t = T::with_limits(Limits { exposure_cap_min: 100 * USDC, exposure_cap_bps: 0, voucher_max_ttl: 300, forced_deadline: 86_400, liveness_deadline: 3 * 86_400 });
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    t.request(&u, 500 * USDC, 3).unwrap();
    let op = t.operator.insecure_clone();
    t.commit(t.batch([1; 32], [0; 32], 1_000 * USDC, 0), &op).unwrap();
    let admin = t.admin.insecure_clone();
    let s = t.settle_ix(3, ta);
    err_has(t.send(&[s], &[&admin]), "OverCap");
    // A stranger can't pose as the operator.
    let stranger = Keypair::new();
    t.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let mut s = t.settle_ix(3, ta);
    s.accounts.last_mut().unwrap().pubkey = stranger.pubkey();
    s.accounts.last_mut().unwrap().is_signer = true;
    err_has(t.send(&[s], &[&admin, &stranger]), "Unauthorized");
    let mut s = t.settle_ix(3, ta);
    s.accounts.last_mut().unwrap().pubkey = op.pubkey();
    s.accounts.last_mut().unwrap().is_signer = true;
    t.send(&[s], &[&admin, &op]).unwrap();
    assert_eq!(t.balance(&ta), 500 * USDC);
    // The approved payout didn't use up the cap: an instant 90 still fits.
    t.withdraw(&u, ta, 90 * USDC, 4).unwrap();
}

/// Compute budget per user-facing instruction (fees scale with requested CU, so keep these small).
#[test]
fn compute_units_stay_small() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    let dep_ix = t.deposit_ix(&u.pubkey(), ta, 500 * USDC);
    let dep = t.send_cu(&[dep_ix], &[&u]).unwrap();
    t.init_page(1);
    let expiry = t.now() + 60;
    let key = t.voucher.clone();
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 100 * USDC, 1, expiry, &key);
    let wd = t.send_cu(&ixs, &[&u]).unwrap();
    let op = t.operator.insecure_clone();
    let b = t.batch([1; 32], [0; 32], 400 * USDC, 0);
    let cb = t.send_cu(&[t.commit_ix(b, &op.pubkey())], &[&op]).unwrap();
    // A batch that also sweeps both the vault and the treasury (two token transfers).
    let mut b = t.batch([2; 32], [0; 32], 400 * USDC, 10 * USDC);
    b.vault = 20 * USDC;
    let sweep = t.send_cu(&[t.commit_ix(b, &op.pubkey())], &[&op]).unwrap();
    println!("CU: commit_batch with vault + treasury sweep {sweep}");
    println!("CU: deposit {dep}, withdraw (incl. ed25519 precompile) {wd}, commit_batch {cb}");
    assert!(dep < 40_000 && wd < 60_000 && cb < 40_000, "deposit {dep}, withdraw {wd}, commit {cb}");
}
