"use client";

import Link from "next/link";
import { LabBar, SCREENS, screenHref } from "./lab-bar";

const CARDS = [
  {
    id: "c-collectible",
    letter: "C",
    name: "Collectible",
    idea: "Every player is a card you collect; on matchday your hand of cards plays.",
    lead: "frontend-design",
    libs: "Motion (board reorders) · hand-drawn SVG charts · CSS transitions for tilt, flip and hover",
    look: "Cool grey ground, white panels, cards in position colours with a shirt-back picture; Sora; compact.",
  },
  {
    id: "d-terminal",
    letter: "D",
    name: "Night terminal (dark wildcard)",
    idea: "The dark build already on the production routes: true black, lime only on data, the matchday strip.",
    lead: "design-taste-frontend (true-black-flat)",
    libs: "shadcn/ui on Radix · Lightweight Charts · CSS transitions",
    look: "#000 → #111 → #2a2a2a by lightness; lime #c6ff3d on gains and live state; Instrument Sans with Chivo figures.",
  },
];

export function LabIndex() {
  return (
    <div data-fullbleed className="min-h-svh bg-[#0e0e0e] px-4 py-10 text-[#e8e8e8] md:px-10">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Design lab · C and D</h1>
          <p className="max-w-[70ch] text-[15px] text-[#a8a8a8]">
            The same three screens (player hub in its trading state, the live matchday, the landing hero) in the two directions still in play, on the same mock
            data. A (Broadcast) and B (Clean fintech) were dropped on 3 Nov.
            Use the bar at the bottom to pin one moment (for example mid-match with KANE, YAMAL and RODRI held) and switch directions without the data
            moving. Dev only: this route is not in production builds.
          </p>
        </header>
        <ul className="grid gap-4 md:grid-cols-2">
          {CARDS.map((c) => (
            <li key={c.id} data-variant={c.letter} className="flex flex-col gap-3 rounded-xl bg-[#181818] p-5">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-semibold">{c.letter}</span>
                <h2 className="text-lg font-medium">{c.name}</h2>
              </div>
              <p className="text-[15px]">{c.idea}</p>
              <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-[#8a8a8a]">Lead skill</dt>
                <dd>{c.lead}</dd>
                <dt className="text-[#8a8a8a]">Libraries</dt>
                <dd>{c.libs}</dd>
                <dt className="text-[#8a8a8a]">Look</dt>
                <dd>{c.look}</dd>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {SCREENS.map((s) => (
                  <Link
                    key={s.id}
                    href={screenHref(c.id, s.id, "kane")}
                    className="rounded-md bg-[#262626] px-3 py-1.5 text-[13px] font-medium hover:bg-[#333] focus-visible:outline-2 focus-visible:outline-white"
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-[#8a8a8a]">
          Briefs, inspiration and the comparison live in <code>docs/INSPIRATION.md</code> and <code>docs/DIRECTIONS.md</code>; screenshots in{" "}
          <code>docs/screenshots/lab/</code>.
        </p>
      </div>
      <LabBar />
    </div>
  );
}
