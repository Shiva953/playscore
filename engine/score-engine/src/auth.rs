//! User signatures on commands.
//!
//! A user command is valid only with an ed25519 signature by `cmd.signer()` (the user's Solana
//! wallet key) over `ORDER_DOMAIN || borsh(cmd)`. Signatures are stored in the log, so anyone
//! replaying it can check that the operator never invented or altered a user's order.

use ed25519_dalek::{Signature, VerifyingKey};

use crate::error::Error;
use crate::types::Cmd;

pub const ORDER_DOMAIN: &[u8] = b"score:order:v1:";

pub type Sig = [u8; 64];

/// The exact bytes a user signs for `cmd`.
pub fn order_message(cmd: &Cmd) -> Vec<u8> {
    let mut m = ORDER_DOMAIN.to_vec();
    borsh::to_writer(&mut m, cmd).expect("writing to a Vec cannot fail");
    m
}

/// User commands need a valid signature by their signer. System commands must carry none.
pub fn verify(cmd: &Cmd, sig: Option<&Sig>) -> Result<(), Error> {
    match (cmd.signer(), sig) {
        (None, None) => Ok(()),
        (None, Some(_)) | (Some(_), None) => Err(Error::BadSignature),
        (Some(user), Some(sig)) => {
            let key = VerifyingKey::from_bytes(user).map_err(|_| Error::BadSignature)?;
            key.verify_strict(&order_message(cmd), &Signature::from_bytes(sig))
                .map_err(|_| Error::BadSignature)
        }
    }
}
