//! Escape hatch: forced requests, exit mode, and exit settlement. Exit tables come from the real
//! engine; on-chain activity after the last batch is settled against the program's `Pending` log.
mod common;

use common::*;

/// Exit mode, end to end: the real engine builds the exit table; the program pays from its proof.
#[test]
fn exit_mode_pays_what_the_engine_committed() {
    let mut t = T::new();
    let mut m = Mirror::new();
    let (a, ta) = t.user(1_000 * USDC);
    let (b, tb) = t.user(1_000 * USDC);
    t.deposit(&a, ta, 700 * USDC).unwrap();
    t.deposit(&b, tb, 300 * USDC).unwrap();
    m.deposit(&a.pubkey(), 700 * USDC);
    m.deposit(&b.pubkey(), 300 * USDC);
    // a locks 200 for voucher 1 and 100 for voucher 2. Voucher 1 is paid on-chain before the
    // batch; voucher 2 is still pending.
    m.lock(&a, 200 * USDC, 1);
    m.lock(&a, 100 * USDC, 2);
    t.withdraw(&a, ta, 200 * USDC, 1).unwrap();
    m.paid(1);
    m.commit(&mut t);

    let enter = ix(score::accounts::EnterExitMode { config: config_pda(), state: state_pda(), oldest: None }, score::instruction::EnterExitMode {});
    let admin = t.admin.insecure_clone();
    err_has(t.send(&[enter], &[&admin]), "ExitNotAllowed");
    t.enter_exit_mode();
    err_has(t.deposit(&b, tb, USDC), "ExitMode");

    let (ua, la, pa) = m.leaf(&a.pubkey());
    let (ub, lb, pb) = m.leaf(&b.pubkey());
    // a can't claim more than committed
    err_has(t.exit(&a, ta, ua + 1, &la, pa.clone()), "BadProof");
    let before = t.balance(&ta);
    t.exit(&a, ta, ua, &la, pa.clone()).unwrap();
    // a gets free USDC (400) + the still-pending voucher 2 (100); voucher 1 was already paid.
    assert_eq!(t.balance(&ta) - before, 400 * USDC + 100 * USDC);
    // once only
    assert!(t.exit(&a, ta, ua, &la, pa).is_err());
    t.exit(&b, tb, ub, &lb, pb).unwrap();
    assert_eq!(t.balance(&tb), 1_000 * USDC);
    assert_eq!(t.custody_balance(), 0);
}

/// Deposits made after the last batch are in custody but in no exit table. Exit mode returns them.
#[test]
fn deposits_after_the_last_batch_come_back_in_exit_mode() {
    let mut t = T::new();
    let mut m = Mirror::new();
    let (a, ta) = t.user(1_000 * USDC);
    let (b, tb) = t.user(1_000 * USDC);
    t.deposit(&a, ta, 700 * USDC).unwrap();
    m.deposit(&a.pubkey(), 700 * USDC);
    m.commit(&mut t);
    // The operator stops here. Both users still deposit.
    t.deposit(&a, ta, 50 * USDC).unwrap();
    t.deposit(&b, tb, 300 * USDC).unwrap();
    t.enter_exit_mode();

    // b has no committed entry at all: exits with nothing claimed and no proof.
    t.exit(&b, tb, 0, &[], vec![]).unwrap();
    assert_eq!(t.balance(&tb), 1_000 * USDC);
    assert!(t.exit(&b, tb, 0, &[], vec![]).is_err(), "only once");
    // Claiming a committed balance still needs to match the exit root.
    let (ua, la, pa) = m.leaf(&a.pubkey());
    err_has(t.exit(&a, ta, ua + 1, &la, pa.clone()), "BadProof");
    // a: committed 700 + the later 50.
    t.exit(&a, ta, ua, &la, pa).unwrap();
    assert_eq!(t.balance(&ta), 1_000 * USDC);
    assert_eq!(t.custody_balance(), 0);
}

/// A withdrawal paid after the last batch is still inside that batch's balance. Exit mode must
/// not pay it again; a lock the batch already listed must not be subtracted either.
#[test]
fn withdrawals_after_the_last_batch_are_not_paid_twice() {
    let mut t = T::new();
    let mut m = Mirror::new();
    let (a, ta) = t.user(1_000 * USDC);
    let (b, tb) = t.user(1_000 * USDC);
    t.deposit(&a, ta, 1_000 * USDC).unwrap();
    t.deposit(&b, tb, 1_000 * USDC).unwrap();
    m.deposit(&a.pubkey(), 1_000 * USDC);
    m.deposit(&b.pubkey(), 1_000 * USDC);
    // b's lock for voucher 2 is in the batch; a's for voucher 1 comes after it.
    m.lock(&b, 300 * USDC, 2);
    m.commit(&mut t);
    t.withdraw(&a, ta, 200 * USDC, 1).unwrap();
    t.withdraw(&b, tb, 300 * USDC, 2).unwrap();
    t.enter_exit_mode();

    let (ua, la, pa) = m.leaf(&a.pubkey());
    assert_eq!((ua, la.len()), (1_000 * USDC, 0));
    t.exit(&a, ta, ua, &la, pa).unwrap();
    assert_eq!(t.balance(&ta), 1_000 * USDC, "1,000 committed − 200 already paid");
    let (ub, lb, pb) = m.leaf(&b.pubkey());
    assert_eq!((ub, lb.clone()), (700 * USDC, vec![(2, 300 * USDC)]));
    t.exit(&b, tb, ub, &lb, pb).unwrap();
    assert_eq!(t.balance(&tb), 1_000 * USDC, "700 committed; the listed lock was already paid");
    assert_eq!(t.custody_balance(), 0);
}

/// A large withdrawal recorded after the last batch can't be settled (no later batch comes), and its
/// voucher is marked used. Exit mode pays it from the lock in the exit table, and only then.
#[test]
fn requests_after_the_last_batch_are_paid_once_in_exit_mode() {
    let mut t = T::with_limits(Limits { exposure_cap_min: 100 * USDC, exposure_cap_bps: 0, voucher_max_ttl: 300, forced_deadline: 86_400, liveness_deadline: 3 * 86_400 });
    let mut m = Mirror::new();
    let (a, ta) = t.user(1_000 * USDC);
    let (b, tb) = t.user(500 * USDC);
    t.deposit(&a, ta, 1_000 * USDC).unwrap();
    t.deposit(&b, tb, 500 * USDC).unwrap();
    m.deposit(&a.pubkey(), 1_000 * USDC);
    m.deposit(&b.pubkey(), 500 * USDC);
    // a's lock (voucher 5) is in the batch; b's (voucher 6) comes after it.
    m.lock(&a, 300 * USDC, 5);
    m.commit(&mut t);
    t.request(&a, 300 * USDC, 5).unwrap();
    t.request(&b, 200 * USDC, 6).unwrap();
    let admin = t.admin.insecure_clone();
    let s = t.settle_ix(5, ta);
    err_has(t.send(&[s], &[&admin]), "NotYet");
    t.enter_exit_mode();
    let s = t.settle_ix(5, ta);
    err_has(t.send(&[s], &[&admin]), "ExitMode");

    let (ua, la, pa) = m.leaf(&a.pubkey());
    assert_eq!(la, vec![(5, 300 * USDC)]);
    // The request account must be the lock's own.
    let mut wrong = t.exit_ix(&a.pubkey(), ta, ua, &la, pa.clone());
    let n = wrong.accounts.len();
    wrong.accounts[n - 1].pubkey = request_pda(6);
    err_has(t.send(&[wrong], &[&a]), "WrongRequest");
    t.exit(&a, ta, ua, &la, pa).unwrap();
    assert_eq!(t.balance(&ta), 1_000 * USDC, "700 committed + the recorded 300");
    // b's lock isn't in the table, so the 200 is still inside b's committed 500.
    let (ub, lb, pb) = m.leaf(&b.pubkey());
    assert_eq!((ub, lb.len()), (500 * USDC, 0));
    t.exit(&b, tb, ub, &lb, pb).unwrap();
    assert_eq!(t.balance(&tb), 500 * USDC);
    let s = t.settle_ix(6, tb);
    err_has(t.send(&[s], &[&admin]), "ExitMode");
    assert_eq!(t.custody_balance(), 0);
}

/// Deposits can run at most PENDING_DEPOSITS ahead of the last batch; the next batch frees room.
#[test]
fn pending_deposits_are_bounded() {
    let mut t = T::new();
    let (u, ta) = t.user(10 * USDC);
    let ix1 = t.deposit_ix(&u.pubkey(), ta, 1);
    for _ in 0..PENDING_DEPOSITS / 16 {
        t.send(&vec![ix1.clone(); 16], &[&u]).unwrap();
    }
    err_has(t.deposit(&u, ta, 1), "TooManyPending");
    let op = t.operator.insecure_clone();
    t.commit(t.batch([1; 32], [0; 32], PENDING_DEPOSITS, 0), &op).unwrap();
    t.deposit(&u, ta, 1).unwrap();
}

/// Payouts are bounded the same way, and settling an exit against two full logs fits in a
/// transaction.
#[test]
fn pending_payouts_are_bounded_and_full_logs_settle() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    let op = t.operator.insecure_clone();
    t.commit(t.batch([1; 32], [0; 32], 1_000 * USDC, 0), &op).unwrap();
    t.init_page(1);
    let key = t.voucher.clone();
    for id in 1..=PENDING_PAYOUTS {
        let ixs = t.withdraw_ixs(&u.pubkey(), ta, 1, id, t.now() + 60, &key);
        t.send(&ixs, &[&u]).unwrap();
    }
    let ixs = t.withdraw_ixs(&u.pubkey(), ta, 1, PENDING_PAYOUTS + 1, t.now() + 60, &key);
    err_has(t.send(&ixs, &[&u]), "TooManyPending");
    let ix1 = t.deposit_ix(&u.pubkey(), ta, 1);
    for _ in 0..(PENDING_DEPOSITS - 1) / 16 {
        t.send(&vec![ix1.clone(); 16], &[&u]).unwrap();
    }
    while t.state().deposit_count - t.state().committed_deposits < PENDING_DEPOSITS {
        t.deposit(&u, ta, 1).unwrap();
    }
    t.enter_exit_mode();
    // Worst case: the settlement walks 1,024 pending deposits and 1,024 pending payouts.
    // ComputeBudget SetComputeUnitLimit(1.4M)
    let mut data = vec![2u8];
    data.extend_from_slice(&1_400_000u32.to_le_bytes());
    let budget = Instruction { program_id: Pubkey::from_str_const("ComputeBudget111111111111111111111111111111"), accounts: vec![], data };
    let exit = t.exit_ix(&u.pubkey(), ta, 0, &[], vec![]);
    let cu = t.send_cu(&[budget, exit], &[&u]).unwrap();
    println!("CU: exit_withdraw over full pending logs {cu}");
    assert!(cu < 400_000, "exit over full logs used {cu}");
}

#[test]
fn ignored_forced_request_opens_exit_mode() {
    let mut t = T::new();
    let (u, _) = t.user(0);
    let req = pda(&[FORCE_SEED, &1u64.to_le_bytes()]);
    let force = ix(
        score::accounts::ForceRequest { user: u.pubkey(), config: config_pda(), state: state_pda(), forced_request: req, system_program: anchor_lang::solana_program::system_program::ID },
        score::instruction::ForceRequest { index: 1, kind: 0, data: [0; 32] },
    );
    t.send(&[force], &[&u]).unwrap();
    let enter = ix(score::accounts::EnterExitMode { config: config_pda(), state: state_pda(), oldest: Some(req) }, score::instruction::EnterExitMode {});
    err_has(t.send(std::slice::from_ref(&enter), &[&u]), "ExitNotAllowed");
    // The operator keeps committing but never serves the request.
    let op = t.operator.insecure_clone();
    t.warp(86_401);
    let mut b = t.batch([1; 32], [0; 32], 0, 0);
    b.forced_served = 0;
    t.commit(b, &op).unwrap();
    t.send(&[enter], &[&u]).unwrap();
    assert_eq!(t.state().exit_mode, 1);
}

fn forced_data(arg: u64) -> [u8; 32] {
    let mut d = [0u8; 32];
    d[..8].copy_from_slice(&arg.to_le_bytes());
    d
}

fn force(t: &mut T, u: &Keypair, index: u64, kind: u8, arg: u64) -> Result<(), String> {
    let req = pda(&[FORCE_SEED, &index.to_le_bytes()]);
    let i = ix(
        score::accounts::ForceRequest { user: u.pubkey(), config: config_pda(), state: state_pda(), forced_request: req, system_program: anchor_lang::solana_program::system_program::ID },
        score::instruction::ForceRequest { index, kind, data: forced_data(arg) },
    );
    t.send(&[i], &[u])
}

fn serve_ix(t: &T, index: u64, user: &Pubkey, user_usdc: Option<Pubkey>, amount: u64, operator: &Pubkey) -> Instruction {
    ix(
        score::accounts::ServeForced {
            operator: *operator,
            config: config_pda(),
            state: state_pda(),
            pending: t.pending,
            forced_request: pda(&[FORCE_SEED, &index.to_le_bytes()]),
            user: *user,
            user_usdc,
            custody: custody_pda(),
            custody_auth: custody_auth_pda(),
            usdc_mint: t.mint,
            token_program: spl_token::ID,
        },
        score::instruction::ServeForced { index, amount },
    )
}

fn engine_forced(index: u64, u: &Pubkey, kind: u8, arg: u64) -> score_engine::Cmd {
    score_engine::Cmd::Forced { index, user: u.to_bytes(), kind, data: forced_data(arg) }
}

fn lamports(t: &T, k: &Pubkey) -> u64 {
    t.svm.get_account(k).map_or(0, |a| a.lamports)
}

#[test]
fn forced_constants_match_the_engine() {
    assert_eq!(FORCED_ID_BIT, score_engine::FORCED_ID_BIT);
    assert_eq!(FORCED_WITHDRAW, score_engine::FORCED_WITHDRAW);
    assert_eq!(FORCED_CANCEL, score_engine::FORCED_CANCEL);
}

/// A forced withdrawal is answered by the operator, paid to the user, and its rent returned. A
/// batch alone can't mark it served, so it can't be quietly skipped.
#[test]
fn forced_withdrawal_is_served_and_paid() {
    let mut t = T::new();
    let mut m = Mirror::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 600 * USDC).unwrap();
    m.deposit(&u.pubkey(), 600 * USDC);
    force(&mut t, &u, 1, FORCED_WITHDRAW, 250 * USDC).unwrap();
    m.system(5, engine_forced(1, &u.pubkey(), FORCED_WITHDRAW, 250 * USDC)).unwrap(); // the watcher, at finalized

    let op = t.operator.insecure_clone();
    let stranger = Keypair::new();
    t.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    err_has(t.send(&[serve_ix(&t, 1, &u.pubkey(), Some(ta), 250 * USDC, &stranger.pubkey())], &[&stranger]), "Unauthorized");
    err_has(t.send(&[serve_ix(&t, 1, &u.pubkey(), Some(ta), 251 * USDC, &op.pubkey())], &[&op]), "ForcedAmount");
    let mut b = t.batch([1; 32], [0; 32], 600 * USDC, 0);
    b.forced_served = 1;
    err_has(t.commit(b, &op), "BadForced");

    let req = pda(&[FORCE_SEED, &1u64.to_le_bytes()]);
    let (sol, usdc) = (lamports(&t, &u.pubkey()), t.balance(&ta));
    let rent = lamports(&t, &req);
    let cu = t.send_cu(&[serve_ix(&t, 1, &u.pubkey(), Some(ta), 250 * USDC, &op.pubkey())], &[&op]).unwrap();
    println!("CU: serve_forced (paying) {cu}");
    assert!(cu < 30_000, "serve_forced used {cu}");
    assert_eq!(t.balance(&ta) - usdc, 250 * USDC);
    assert_eq!(lamports(&t, &u.pubkey()) - sol, rent, "the request's rent goes back to the user");
    assert_eq!(lamports(&t, &req), 0);
    assert_eq!(t.state().forced_served, 1);
    // The engine sees the payout like any other; the next batch's reserves check passes.
    m.paid(FORCED_ID_BIT | 1);
    t.warp(86_401);
    m.commit(&mut t);
    let enter = ix(score::accounts::EnterExitMode { config: config_pda(), state: state_pda(), oldest: None }, score::instruction::EnterExitMode {});
    err_has(t.send(&[enter], &[&op]), "ExitNotAllowed");
}

/// Answered strictly in order; only withdrawals pay; others (and unpayable withdrawals) are
/// answered with nothing. Voucher ids can't borrow the forced id space.
#[test]
fn forced_requests_are_answered_in_order() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 500 * USDC).unwrap();
    force(&mut t, &u, 1, FORCED_CANCEL, 7).unwrap();
    force(&mut t, &u, 2, FORCED_WITHDRAW, 0).unwrap();
    let op = t.operator.insecure_clone();
    err_has(t.send(&[serve_ix(&t, 2, &u.pubkey(), Some(ta), USDC, &op.pubkey())], &[&op]), "WrongForcedRequest");
    err_has(t.send(&[serve_ix(&t, 1, &u.pubkey(), Some(ta), USDC, &op.pubkey())], &[&op]), "ForcedAmount");
    t.send(&[serve_ix(&t, 1, &u.pubkey(), None, 0, &op.pubkey())], &[&op]).unwrap();
    // "Everything": any amount up to the user's balance (the engine's hold decides it).
    t.send(&[serve_ix(&t, 2, &u.pubkey(), Some(ta), 500 * USDC, &op.pubkey())], &[&op]).unwrap();
    assert_eq!(t.balance(&ta), 1_000 * USDC);
    assert_eq!((t.state().forced_count, t.state().forced_served), (2, 2));
    err_has(t.withdraw(&u, ta, USDC, FORCED_ID_BIT | 5), "WrongPage");
}

/// Exit mode after forced holds made the exit table: paid after the cut → not paid again;
/// answered without payment, or never answered → paid once from the exit table.
#[test]
fn forced_holds_are_paid_once_in_exit_mode() {
    let mut t = T::new();
    let mut m = Mirror::new();
    let users: Vec<(Keypair, Pubkey)> = (0..3).map(|_| t.user(1_000 * USDC)).collect();
    for (i, (u, ta)) in users.iter().enumerate() {
        t.deposit(u, *ta, 500 * USDC).unwrap();
        m.deposit(&u.pubkey(), 500 * USDC);
        force(&mut t, u, i as u64 + 1, FORCED_WITHDRAW, 200 * USDC).unwrap();
        m.system(5, engine_forced(i as u64 + 1, &u.pubkey(), FORCED_WITHDRAW, 200 * USDC)).unwrap();
    }
    m.commit(&mut t); // each 200 is a forced hold in the exit table
    let op = t.operator.insecure_clone();
    let (a, ta) = (&users[0].0, users[0].1);
    let (b, _) = (&users[1].0, users[1].1);
    t.send(&[serve_ix(&t, 1, &a.pubkey(), Some(ta), 200 * USDC, &op.pubkey())], &[&op]).unwrap(); // paid after the cut
    t.send(&[serve_ix(&t, 2, &b.pubkey(), None, 0, &op.pubkey())], &[&op]).unwrap(); // answered, unpaid
    // (3 is never answered.) The operator disappears.
    t.enter_exit_mode();
    let expect = [300 * USDC, 500 * USDC, 500 * USDC];
    for ((u, ta), want) in users.iter().zip(expect) {
        let (usdc, locks, proof) = m.leaf(&u.pubkey());
        assert_eq!(locks.len(), 1);
        let before = t.balance(ta);
        let k = u.insecure_clone();
        t.exit(&k, *ta, usdc, &locks, proof).unwrap();
        assert_eq!(t.balance(ta) - before, want);
    }
    assert_eq!(t.custody_balance(), 0);
}
