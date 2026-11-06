use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ScoreError;
use crate::state::{Config, Keys, Limits, Pending, State};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// Only the program's upgrade authority may initialise, so setup can't be front-run.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ScoreError::Unauthorized)]
    pub program: Program<'info, crate::program::Score>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ScoreError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<Config>(), seeds = [CONFIG_SEED], bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<State>(), seeds = [STATE_SEED], bump)]
    pub state: AccountLoader<'info, State>,
    /// Created by the caller in the same transaction (system `create_account`, owner = this program,
    /// space = 8 + size_of::<Pending>()), because it is larger than a program may create.
    #[account(zero)]
    pub pending: AccountLoader<'info, Pending>,
    /// CHECK: PDA with no data; the custody token account's authority. Only signs via seeds.
    #[account(seeds = [CUSTODY_AUTH_SEED], bump)]
    pub custody_auth: UncheckedAccount<'info>,
    #[account(init, payer = authority, seeds = [CUSTODY_SEED], bump, token::mint = usdc_mint, token::authority = custody_auth)]
    pub custody: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA with no data; the vault token account's authority. Only signs via seeds.
    #[account(seeds = [VAULT_AUTH_SEED], bump)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(init, payer = authority, seeds = [VAULT_SEED], bump, token::mint = usdc_mint, token::authority = vault_auth)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA with no data; the treasury token account's authority. Only signs via seeds.
    #[account(seeds = [TREASURY_AUTH_SEED], bump)]
    pub treasury_auth: UncheckedAccount<'info>,
    #[account(init, payer = authority, seeds = [TREASURY_SEED], bump, token::mint = usdc_mint, token::authority = treasury_auth)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, admin: Pubkey, keys: Keys, limits: Limits) -> Result<()> {
    require!(limits.valid(), ScoreError::BadLimits);
    // Every other instruction checks these accounts against precomputed constants.
    let a = &ctx.accounts;
    require_keys_eq!(a.config.key(), CONFIG_ADDRESS);
    require_keys_eq!(a.state.key(), STATE_ADDRESS);
    require_keys_eq!(a.custody_auth.key(), CUSTODY_AUTH_ADDRESS);
    require_keys_eq!(a.vault_auth.key(), VAULT_AUTH_ADDRESS);
    require_keys_eq!(a.treasury_auth.key(), TREASURY_AUTH_ADDRESS);
    require!(
        ctx.bumps.custody_auth == CUSTODY_AUTH_BUMP && ctx.bumps.vault_auth == VAULT_AUTH_BUMP && ctx.bumps.treasury_auth == TREASURY_AUTH_BUMP,
        ScoreError::Unauthorized
    );
    let mut c = ctx.accounts.config.load_init()?;
    c.admin = admin;
    c.set_nominee(None);
    c.keys = keys;
    c.limits = limits;
    c.usdc_mint = ctx.accounts.usdc_mint.key();
    c.custody = ctx.accounts.custody.key();
    c.vault = ctx.accounts.vault.key();
    c.treasury = ctx.accounts.treasury.key();
    c.pending = ctx.accounts.pending.key();
    let mut st = ctx.accounts.state.load_init()?;
    st.last_commit_ts = Clock::get()?.unix_timestamp;
    ctx.accounts.pending.load_init()?;
    Ok(())
}
