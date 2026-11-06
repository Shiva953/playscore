//! Admin: initialisation, pause, admin transfer, treasury.
mod common;

use common::*;

#[test]
fn only_the_upgrade_authority_can_initialize() {
    let mut t = T::new();
    // already initialized: a second init fails (accounts exist)
    let admin = t.admin.insecure_clone();
    let limits = t.config().limits;
    assert!(t.initialize(&admin, limits).is_err());
    // fresh deployment: a stranger can't initialize it
    let mut svm = LiteSVM::new();
    let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/score.so")).unwrap();
    svm.add_program(score::ID, &so).unwrap();
    let mut t2 = T { svm, admin: Keypair::new(), operator: Keypair::new(), pauser: Keypair::new(), voucher: SigningKey::from_bytes(&[1; 32]), mint: t.mint, mint_auth: Keypair::new(), pending: Pubkey::default() };
    t2.svm.airdrop(&t2.admin.pubkey(), 10_000_000_000).unwrap();
    let mint_acc = t.svm.get_account(&t.mint).unwrap();
    t2.svm.set_account(t.mint, mint_acc).unwrap();
    t2.set_upgrade_authority(Some(Pubkey::new_unique()));
    let stranger = t2.admin.insecure_clone();
    err_has(t2.initialize(&stranger, limits), "Unauthorized");
}

#[test]
fn pauser_can_pause_but_only_admin_unpauses() {
    let mut t = T::new();
    let (u, ta) = t.user(100 * USDC);
    let set = |who: &Keypair, flags: u8| ix(score::accounts::SetPause { signer: who.pubkey(), config: config_pda(), state: state_pda() }, score::instruction::SetPause { flags });
    let pauser = t.pauser.insecure_clone();
    let admin = t.admin.insecure_clone();
    t.svm.airdrop(&pauser.pubkey(), 1_000_000_000).unwrap();
    t.send(&[set(&pauser, PAUSE_DEPOSITS)], &[&pauser]).unwrap();
    err_has(t.deposit(&u, ta, USDC), "Paused");
    err_has(t.send(&[set(&pauser, 0)], &[&pauser]), "PauserCannotUnpause");
    let (rando, _) = t.user(0);
    err_has(t.send(&[set(&rando, PAUSE_ALL)], &[&rando]), "Unauthorized");
    t.send(&[set(&admin, 0)], &[&admin]).unwrap();
    t.deposit(&u, ta, USDC).unwrap();
}

#[test]
fn admin_transfer_is_two_step() {
    let mut t = T::new();
    let admin = t.admin.insecure_clone();
    let (next, _) = t.user(0);
    let (rando, _) = t.user(0);
    let nominate = ix(score::accounts::AdminOnly { admin: admin.pubkey(), config: config_pda() }, score::instruction::NominateAdmin { new_admin: next.pubkey() });
    t.send(&[nominate], &[&admin]).unwrap();
    assert_eq!(t.config().admin, admin.pubkey());
    let accept = |who: &Keypair| ix(score::accounts::AcceptAdmin { new_admin: who.pubkey(), config: config_pda() }, score::instruction::AcceptAdmin {});
    err_has(t.send(&[accept(&rando)], &[&rando]), "Unauthorized");
    t.send(&[accept(&next)], &[&next]).unwrap();
    assert_eq!(t.config().admin, next.pubkey());
    // The old admin lost its powers.
    let limits = t.config().limits;
    let old = ix(score::accounts::AdminOnly { admin: admin.pubkey(), config: config_pda() }, score::instruction::SetLimits { limits });
    err_has(t.send(&[old], &[&admin]), "Unauthorized");
}

#[test]
fn treasury_withdrawals_are_bounded_and_serialised() {
    let mut t = T::new();
    let (u, ta) = t.user(1_000 * USDC);
    t.deposit(&u, ta, 1_000 * USDC).unwrap();
    let op = t.operator.insecure_clone();
    let admin = t.admin.insecure_clone();
    let dest = Pubkey::new_unique();
    t.token_account(dest, admin.pubkey(), 0);
    t.commit(t.batch([1; 32], [0; 32], 1_000 * USDC, 50 * USDC), &op).unwrap();
    // The batch swept the engine's treasury figure out of custody.
    assert_eq!((t.custody_balance(), t.balance(&treasury_pda())), (950 * USDC, 50 * USDC));
    let wt = |amount: u64, t: &T| {
        ix(
            score::accounts::WithdrawTreasury {
                admin: admin.pubkey(),
                config: config_pda(),
                state: state_pda(),
                pending: t.pending,
                to: dest,
                treasury: treasury_pda(),
                treasury_auth: treasury_auth_pda(),
                usdc_mint: t.mint,
                token_program: spl_token::ID,
            },
            score::instruction::WithdrawTreasury { amount },
        )
    };
    let w = wt(60 * USDC, &t);
    err_has(t.send(&[w], &[&admin]), "TreasuryLow");
    let w = wt(20 * USDC, &t);
    t.send(&[w], &[&admin]).unwrap();
    assert_eq!(t.balance(&dest), 20 * USDC);
    assert_eq!((t.custody_balance(), t.balance(&treasury_pda())), (950 * USDC, 30 * USDC), "paid from the treasury, not custody");
    // The admin's instruction can't be pointed at custody.
    let mut w = wt(10 * USDC, &t);
    w.accounts[5].pubkey = custody_pda();
    err_has(t.send(&[w], &[&admin]), "ConstraintHasOne");
    let w = wt(10 * USDC, &t);
    err_has(t.send(&[w], &[&admin]), "TreasuryPending");
    // The next batch must consume the treasury payout.
    let mut b = t.batch([2; 32], [0; 32], 980 * USDC, 30 * USDC);
    b.payouts = 0;
    b.payout_hash = [0; 32];
    err_has(t.commit(b, &op), "TreasuryPending");
    t.commit(t.batch([2; 32], [0; 32], 980 * USDC, 30 * USDC), &op).unwrap();
    let w = wt(10 * USDC, &t);
    t.send(&[w], &[&admin]).unwrap();
}
