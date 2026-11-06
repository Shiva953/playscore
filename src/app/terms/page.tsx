import type { Metadata } from "next";
import { RESTRICTED_COUNTRIES } from "@score/core";

export const metadata: Metadata = { title: "Terms & Conditions" };

/** Ported from the prototype's `terms()` draft. Not final and not legal advice. */
const SECTIONS: [string, string][] = [
  [
    "1. Eligibility and restricted jurisdictions",
    `You must be at least 18 and not located in, resident in, or a national of a restricted jurisdiction. Draft restricted list: ${RESTRICTED_COUNTRIES.join(", ")}. The list reflects sanctions and the regulatory positions we are currently assessing, and counsel will confirm it before launch. We use IP geofencing at the network edge, a location check and attestation at sign-in, and wallet screening. We may block or close accounts that appear to circumvent these checks, for example with a VPN.`,
  ],
  [
    "2. What score is",
    "score lets you buy and sell tokens linked to the performance of real football players and receive dividends paid from a protocol vault. Tokens are not shares in any player, club or league, and have no connection to them. Player names are used to identify the data we score.",
  ],
  [
    "3. Risks",
    "Token prices can fall to near zero. Dividends are not guaranteed: they depend on the vault balance, a payout controller that can reduce them, and new launches that fund it. You can lose everything you put in. Past performance does not predict future results. This is a testnet prototype with no real funds.",
  ],
  [
    "4. Fees",
    "ICO purchases and sales pay a flat 1.25%. After a player bonds, buys pay 5 bps and sells pay a tax that falls from 5% to 0.5% over 90 days of holding. Buy-side fees go to the treasury. Sell-side fees go 90% to the dividend vault and 10% to the treasury.",
  ],
  [
    "5. Scoring and data",
    "Scores are computed by our scoring engine from licensed third-party match data, frozen 12 hours after the last whistle of a matchday. Frozen results are final and later data corrections are not applied.",
  ],
  [
    "6. Accounts and wallets",
    "Sign-in creates an embedded wallet. Positions are held in the protocol, not as free-moving tokens in your wallet, so dividend snapshots and trading rules can be enforced. You are responsible for your login credentials.",
  ],
  [
    "7. Prohibited conduct",
    "Wash trading, multiple accounts to exceed purchase limits or inflate activity, market manipulation, use of bots without permission, and attempts to bypass geo-restrictions. We may void activity and remove points or rewards.",
  ],
  ["8. Changes and governing law", "We may change parameters through a published, time-locked process. Governing law and dispute resolution: to be set by counsel."],
];

export default function Page() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em] text-ink">Terms &amp; Conditions</h1>
        <p className="text-sm text-soft">Draft for legal review. Not final and not legal advice. Last updated 28 Oct 2026.</p>
      </header>
      {SECTIONS.map(([h, b]) => (
        <section key={h} className="flex flex-col gap-2">
          <h2 className="text-base font-medium text-ink">{h}</h2>
          <p className="max-w-[68ch] text-[15px] leading-relaxed text-soft">{b}</p>
        </section>
      ))}
      <p className="text-xs text-soft">
        Open item for counsel: section 4 doesn&apos;t yet mention the proposed 0.25% liquidity-provider fee on pool swaps.
      </p>
    </article>
  );
}
