use anchor_lang::prelude::*;

use crate::constants::PAGE_BITS;

/// Bitmap of used voucher ids `page * 8192 .. page * 8192 + 8191`.
#[account(zero_copy)]
#[derive(Debug)]
pub struct VoucherPage {
    pub page: u64,
    pub bits: [u8; 1024],
}

impl VoucherPage {
    /// Set the bit for `id`; returns whether it was already set.
    pub fn test_and_set(&mut self, id: u64) -> bool {
        let bit = (id % PAGE_BITS) as usize;
        let (byte, mask) = (bit / 8, 1u8 << (bit % 8));
        let was = self.bits[byte] & mask != 0;
        self.bits[byte] |= mask;
        was
    }

    pub fn is_set(&self, id: u64) -> bool {
        let bit = (id % PAGE_BITS) as usize;
        self.bits[bit / 8] & (1u8 << (bit % 8)) != 0
    }
}
