//! Batches: every commit_batch check.
mod common;

use common::*;

#[test]
fn commit_batch_checks_everything() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 600 * USDC).unwrap();
    let op = t.operator.insecure_clone();
    let stranger = Keypair::new();
    t.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    err_has(t.commit(t.batch([1; 32], [0; 32], 600 * USDC, 0), &stranger), "Unauthorized");
    let mut b = t.batch([1; 32], [0; 32], 600 * USDC, 0);
    b.seq += 1;
    err_has(t.commit(b, &op), "BadSequence");
    let mut b = t.batch([1; 32], [0; 32], 600 * USDC, 0);
    b.prev_state_root = [7; 32];
    err_has(t.commit(b, &op), "BadPrevRoot");
    let mut b = t.batch([1; 32], [0; 32], 600 * USDC, 0);
    b.deposit_hash = [3; 32];
    err_has(t.commit(b, &op), "BadDeposits");
    let mut b = t.batch([1; 32], [0; 32], 600 * USDC, 0);
    b.deposits = 5;
    err_has(t.commit(b, &op), "BadDeposits");
    // Engine claims to owe more than custody holds.
    err_has(t.commit(t.batch([1; 32], [0; 32], 600 * USDC + 1, 0), &op), "Undercollateralised");
    t.commit(t.batch([1; 32], [0; 32], 600 * USDC, 0), &op).unwrap();
    // A cut before the latest deposit is fine when the reserves adjust for it.
    t.deposit(&u, ta, 100 * USDC).unwrap();
    let mut b = t.batch([2; 32], [0; 32], 600 * USDC, 0);
    b.deposits = 1;
    b.deposit_hash = deposit_link(&[0; 32], 1, &u.pubkey(), 600 * USDC);
    t.commit(b.clone(), &op).unwrap();
    // ...but never moving backwards.
    let mut b2 = t.batch([3; 32], [0; 32], 600 * USDC, 0);
    b2.deposits = 0;
    b2.deposit_hash = [0; 32];
    err_has(t.commit(b2, &op), "BadDeposits");
}

/// Each batch moves only the change in the engine's vault and treasury figures, in the right
/// direction, and can never take more out of custody than users are not owed.
#[test]
fn batches_sync_the_vault_and_treasury() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    let op = t.operator.insecure_clone();
    let held = |t: &T| (t.custody_balance(), t.balance(&vault_pda()), t.balance(&treasury_pda()));

    // Fees and taxes so far: vault 100, treasury 30. Custody keeps the 870 owed to users.
    let mut b = t.batch([1; 32], [0; 32], 1_000 * USDC, 30 * USDC);
    b.vault = 100 * USDC;
    t.commit(b, &op).unwrap();
    assert_eq!(held(&t), (870 * USDC, 100 * USDC, 30 * USDC));

    // A round credits 40 of dividends to holders (vault 100 → 60) and fees add 15 to the treasury.
    let mut b = t.batch([2; 32], [0; 32], 1_000 * USDC, 45 * USDC);
    b.vault = 60 * USDC;
    t.commit(b, &op).unwrap();
    assert_eq!(held(&t), (895 * USDC, 60 * USDC, 45 * USDC), "vault → custody 40, custody → treasury 15");

    // A batch can't take money out of the treasury.
    let mut b = t.batch([3; 32], [0; 32], 1_000 * USDC, 40 * USDC);
    b.vault = 60 * USDC;
    err_has(t.commit(b, &op), "TreasuryDecrease");
    // Custody must still cover what users are owed after the sweep (895 here).
    let mut b = t.batch([3; 32], [0; 32], 1_001 * USDC, 45 * USDC);
    b.vault = 60 * USDC;
    err_has(t.commit(b, &op), "Undercollateralised");
    // Vault and treasury figures can't exceed everything the engine holds.
    let mut b = t.batch([3; 32], [0; 32], 100 * USDC, 45 * USDC);
    b.vault = 60 * USDC;
    err_has(t.commit(b, &op), "Undercollateralised");
    // ...and a batch can't sweep user money into the vault.
    let mut b = t.batch([3; 32], [0; 32], 1_000 * USDC, 45 * USDC);
    b.vault = 2_000 * USDC;
    err_has(t.commit(b, &op), "Undercollateralised");
    assert_eq!(held(&t), (895 * USDC, 60 * USDC, 45 * USDC));
}

/// Dividends are chain-first: a round result only sets the money aside; the batch moving it from
/// the vault account into custody can fail without anyone having been credited; holders are
/// credited only once a batch covering the result is finalized.
#[test]
fn dividends_are_credited_only_after_their_batch_is_final() {
    use score_engine::{math as m, Cmd, Error};
    let mut t = T::new();
    let mut e = Mirror::new();
    const P: u32 = 1;
    e.system(1, Cmd::ListPlayer { player: P }).unwrap();
    // Enough curve buyers to graduate the player (each capped at 3% of the float), all with real
    // on-chain deposits.
    let mut holders = vec![];
    loop {
        let (u, ta) = t.user(5_000 * USDC);
        t.deposit(&u, ta, 5_000 * USDC).unwrap();
        e.deposit(&u.pubkey(), 5_000 * USDC);
        let sold = e.seq.engine.market(P).unwrap().sold as u128;
        let cost = m::curve_cost(sold, m::MAX_BUY_BASE - 5_000).unwrap();
        let usdc_in = (cost + m::fee(cost, m::ICO_FEE_BPS).unwrap()) as u64;
        let out = e.signed(2, &u, |nonce| Cmd::BuyCurve { user: u.pubkey().to_bytes(), nonce, player: P, usdc_in, min_tokens: 1 });
        holders.push((u, ta));
        if matches!(out, score_engine::Outcome::Bought { graduated: true, .. }) {
            break;
        }
    }
    // Batch 1: graduation's 20% (plus fees) moves into the vault account.
    e.commit(&mut t);
    let vault0 = e.seq.engine.vault();
    assert_eq!(t.balance(&vault_pda()), vault0);

    // Round 1: kickoff snapshot, then the result. Step 1 sets the payout aside.
    e.system(3, Cmd::PublishCalendar { round: 1, lock_ts: 10 }).unwrap();
    e.system(10, Cmd::Snapshot { round: 1 }).unwrap();
    e.system(11, Cmd::RoundResult { round: 1, payouts: vec![(P, 1_000 * USDC)] }).unwrap();
    let reserved = e.seq.engine.reserved();
    assert!(reserved > 0 && e.seq.engine.claimable() == 0);
    let (u0, _) = &holders[0];
    let claim = |e: &mut Mirror, u: &Keypair| -> Result<(), Error> {
        let n = e.seq.engine.account(&u.pubkey().to_bytes()).nonce + 1;
        let c = Cmd::Claim { user: u.pubkey().to_bytes(), nonce: n, round: 1, player: P, take_tokens: false };
        let sig: [u8; 64] = u.sign_message(&score_engine::auth::order_message(&c)).as_ref().try_into().unwrap();
        e.seq.submit(12, c, Some(sig)).map(|_| ())
    };
    assert_eq!(claim(&mut e, u0), Err(Error::NothingToClaim), "nothing to spend before the money is in custody");

    // The batch that would move it fails (here: signed by the wrong key). Nothing moved, nobody
    // was credited, and the engine needs no undo.
    let stranger = Keypair::new();
    t.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let custody0 = t.custody_balance();
    let mut bad = t.batch([7; 32], [0; 32], 0, 0);
    bad.vault = e.seq.engine.vault();
    err_has(t.commit(bad, &stranger), "Unauthorized");
    assert_eq!((t.custody_balance(), t.balance(&vault_pda())), (custody0, vault0));
    assert_eq!(e.seq.engine.claimable(), 0);

    // The next batch moves exactly the set-aside amount from the vault into custody.
    let cut = e.seq.engine.applied();
    e.commit(&mut t);
    assert_eq!(t.balance(&vault_pda()), vault0 - reserved);
    assert_eq!(t.custody_balance(), custody0 + reserved);
    assert_eq!(e.seq.engine.claimable(), 0, "still nothing until the batch is finalized");

    // The watcher sees that batch finalized: step 2 credits the holders, who can now claim.
    e.system(12, Cmd::BatchFinalized { cut }).unwrap();
    assert_eq!((e.seq.engine.reserved(), e.seq.engine.claimable()), (0, reserved));
    claim(&mut e, u0).unwrap();
    e.seq.engine.check_invariants().unwrap();
}
