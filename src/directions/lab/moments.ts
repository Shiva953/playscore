import type { MockProtocolClient } from "@/lib/protocol/mock/client";

/**
 * Lab moments: put the shared mock world at one comparable instant, so every direction is judged
 * on the same data. Each preset signs in a demo account, holds three trading players at kickoff,
 * moves the round to the moment and pins it.
 */
export type MomentId = "live" | "open" | "fulltime";

export const MOMENTS: { id: MomentId; label: string; hint: string }[] = [
  { id: "live", label: "Mid-match", hint: "Live, 55% through the window, three players held at kickoff" },
  { id: "open", label: "Before kickoff", hint: "Trading open, countdown to the snapshot" },
  { id: "fulltime", label: "Full time", hint: "Round settled, dividends waiting to be claimed" },
];

/** Bought before kickoff so they count in the snapshot. */
const HOLDINGS: [string, number][] = [
  ["kane", 150],
  ["yamal", 120],
  ["rodri", 90],
];

async function phase(client: MockProtocolClient) {
  return (await client.getRound()).phase;
}

export async function pinMoment(client: MockProtocolClient, id: MomentId): Promise<void> {
  client.setPinned(false);
  if (client.getDemoSettings().clockMode !== "demo") client.updateDemoSettings({ clockMode: "demo" });
  if (!(await client.getSession())) await client.signIn({ method: "google", country: "Germany", acceptedTerms: true });

  // Holdings only count if held at kickoff, so get to an open phase first.
  for (let i = 0; i < 3 && (await phase(client)) !== "open"; i++) client.skipPhase();

  const pf = await client.getPortfolio();
  for (const [pid, usdc] of HOLDINGS) {
    const held = pf?.positions.find((p) => p.playerId === pid)?.tokens ?? 0;
    if (held <= 0) await client.buy(pid, usdc);
  }

  if (id === "open") {
    client.seekPhase(0.35);
  } else if (id === "live") {
    client.skipPhase(); // kickoff: snapshot
    client.seekPhase(0.55);
  } else {
    client.skipPhase(); // kickoff
    client.skipPhase(); // full time: settle
    client.seekPhase(0.1);
  }
  client.setPinned(true);
}

export function releaseMoment(client: MockProtocolClient): void {
  client.setPinned(false);
}
