export const DOC_SECTIONS = [
  { slug: "stats", title: "Stats" },
  { slug: "scoring", title: "Scoring" },
  { slug: "boards", title: "Boards & payouts" },
  { slug: "fees", title: "Fees & curve" },
  { slug: "dividends", title: "Dividends & supply" },
  { slug: "liquidity", title: "Liquidity" },
  { slug: "governance", title: "Governance" },
] as const;

export type DocSlug = (typeof DOC_SECTIONS)[number]["slug"];
