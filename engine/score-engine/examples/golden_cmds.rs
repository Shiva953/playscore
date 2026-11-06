//! Prints the borsh encoding of sample commands, as golden vectors for other-language encoders.
use score_engine::*;

fn main() {
    let u = [7u8; 32];
    let cmds: Vec<(&str, Cmd)> = vec![
        ("LockWithdraw", Cmd::LockWithdraw { user: u, nonce: 3, amount: 50_000_000, id: 12, expiry: 1_800_000_000 }),
        ("BuyCurve", Cmd::BuyCurve { user: u, nonce: 1, player: 9, usdc_in: 100_000_000, min_tokens: 1 }),
        ("SellCurve", Cmd::SellCurve { user: u, nonce: 2, player: 9, tokens: 5_000, min_usdc: 0 }),
        ("Buy", Cmd::Buy { user: u, nonce: 4, player: 9, usdc_in: 20_000_000, min_tokens: 0, limit_px: 0 }),
        ("Sell", Cmd::Sell { user: u, nonce: 5, player: 9, tokens_in: 1_000_000, min_usdc: 0, limit_px: 123 }),
        ("PlaceOrder", Cmd::PlaceOrder { user: u, nonce: 6, player: 9, side: Side::Ask, px: 4_000_000, amount: 77, post_only: true }),
        ("CancelOrder", Cmd::CancelOrder { user: u, nonce: 7, order: 5 }),
        ("AddLiquidity", Cmd::AddLiquidity { user: u, nonce: 8, player: 9, lower_px: 0, upper_px: 0, max_usdc: 10_000_000, max_tokens: 999, min_liquidity: (1u128 << 70) + 5 }),
        ("RemoveLiquidity", Cmd::RemoveLiquidity { user: u, nonce: 9, position: 4, liquidity: 1u128 << 65, min_usdc: 0, min_tokens: 0 }),
        ("Claim", Cmd::Claim { user: u, nonce: 10, round: 2, player: 9, take_tokens: false }),
        ("ListPlayer", Cmd::ListPlayer { player: 9 }),
        ("PublishCalendar", Cmd::PublishCalendar { round: 2, lock_ts: 1_800_000_000 }),
        ("Snapshot", Cmd::Snapshot { round: 2 }),
        ("RoundResult", Cmd::RoundResult { round: 2, payouts: vec![(9, 500_000_000), (10, 1)] }),
    ];
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    println!("{{");
    for (i, (name, c)) in cmds.iter().enumerate() {
        let comma = if i + 1 < cmds.len() { "," } else { "" };
        println!("  \"{name}\": \"{}\"{comma}", hex(&borsh::to_vec(c).unwrap()));
    }
    println!("}}");
}
