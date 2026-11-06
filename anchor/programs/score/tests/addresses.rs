//! The fixed accounts are checked against precomputed constants instead of re-deriving their PDAs
//! on every instruction. These must match the real derivation for this program id.
mod common;

use common::*;

#[test]
fn precomputed_addresses_match_their_seeds() {
    for (seed, address, bump) in [
        (CONFIG_SEED, CONFIG_ADDRESS, None),
        (STATE_SEED, STATE_ADDRESS, None),
        (CUSTODY_AUTH_SEED, CUSTODY_AUTH_ADDRESS, Some(CUSTODY_AUTH_BUMP)),
        (VAULT_AUTH_SEED, VAULT_AUTH_ADDRESS, Some(VAULT_AUTH_BUMP)),
        (TREASURY_AUTH_SEED, TREASURY_AUTH_ADDRESS, Some(TREASURY_AUTH_BUMP)),
    ] {
        let (pda, b) = Pubkey::find_program_address(&[seed], &score::ID);
        assert_eq!(pda.to_bytes(), address.to_bytes(), "{}", String::from_utf8_lossy(seed));
        if let Some(bump) = bump {
            assert_eq!(b, bump, "{}", String::from_utf8_lossy(seed));
        }
    }
}

#[test]
fn a_substitute_state_account_is_rejected() {
    let mut t = T::new();
    let (u, ta) = t.user(10 * USDC);
    // A copy of the real state at another address, owned by the program, with the right type.
    let real = t.svm.get_account(&state_pda()).unwrap();
    let fake = Pubkey::new_unique();
    t.svm.set_account(fake, real).unwrap();
    let mut i = t.deposit_ix(&u.pubkey(), ta, USDC);
    i.accounts[2].pubkey = fake;
    err_has(t.send(&[i], &[&u]), "ConstraintAddress");
}
