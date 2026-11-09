"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMockClient } from "@/lib/protocol/react/provider";
import type { MockProtocolClient } from "@/lib/protocol/mock/client";
import { useRound } from "@/lib/protocol/react/hooks";
import { MOMENTS, pinMoment, releaseMoment, type MomentId } from "./moments";

export const DIRECTIONS = [
  { id: "c-collectible", letter: "C", name: "Collectible" },
  { id: "d-terminal", letter: "D", name: "Night terminal" },
] as const;

export const SCREENS = [
  { id: "player", name: "Player" },
  { id: "matchday", name: "Matchday" },
  { id: "landing", name: "Landing" },
] as const;

/** Direction D is the dark build already on the production routes. */
export function screenHref(direction: string, screen: string, player: string): string {
  if (direction === "d-terminal") return screen === "player" ? `/player/${player}` : screen === "matchday" ? "/matchday" : "/";
  return `/lab/${direction}/${screen}${screen === "player" ? `?player=${player}` : ""}`;
}

/**
 * Lab tooling, not part of any direction: switch direction and screen, and pin the shared mock
 * world at one moment. Hidden in screenshots (`data-lab-bar`).
 */
export function LabBar() {
  // The lab pins the mock's world; on the real backend there's nothing to pin.
  const client = useMockClient();
  if (!client) return null;
  return (
    <Suspense fallback={null}>
      <Bar client={client} />
    </Suspense>
  );
}

/** In the C review deploy the bar is a demo control: C's screens and the moments only. */
const REVIEW_C = process.env.NEXT_PUBLIC_SCORE_DIRECTION === "c";

function Bar({ client }: { client: MockProtocolClient }) {
  const path = usePathname();
  const params = useSearchParams();
  const phase = useRound((r) => r.phase);
  const [open, setOpen] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState<MomentId | null>(null);
  const [, dir, screen] = (path ?? "").split("/").filter(Boolean);
  const player = params.get("player") ?? "bellingham";

  useEffect(() => {
    const sync = () => setPinned(client.getDemoSettings().pinned);
    sync();
    return client.subscribe((e) => {
      if (e.type === "user" || e.type === "reset") sync();
    });
  }, [client]);

  const pin = async (id: MomentId) => {
    setBusy(id);
    try {
      await pinMoment(client, id);
    } finally {
      setBusy(null);
    }
  };

  const btn: React.CSSProperties = {
    height: 28,
    padding: "0 10px",
    borderRadius: 6,
    border: "1px solid #3a3a3a",
    background: "transparent",
    color: "#e8e8e8",
    font: "500 12px/26px system-ui, sans-serif",
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    display: "inline-block",
  };
  const on: React.CSSProperties = { ...btn, background: "#e8e8e8", color: "#111", borderColor: "#e8e8e8" };

  if (!open) {
    return (
      <button data-lab-bar type="button" onClick={() => setOpen(true)} style={{ ...btn, position: "fixed", left: 12, bottom: 12, zIndex: 90, background: "#161616" }}>
        {REVIEW_C ? "Demo" : "Lab"}
      </button>
    );
  }

  return (
    <div
      data-lab-bar
      role="toolbar"
      aria-label="Design lab"
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 90,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        maxWidth: "calc(100vw - 24px)",
        padding: 8,
        borderRadius: 10,
        background: "#161616",
        boxShadow: "0 8px 24px rgba(0,0,0,.35)",
        font: "12px system-ui, sans-serif",
        color: "#a8a8a8",
      }}
    >
      <Link href={REVIEW_C ? "/lab/c-collectible/landing" : "/lab"} style={{ ...btn, border: "none", color: "#a8a8a8" }}>
        {REVIEW_C ? "Demo" : "Lab"}
      </Link>
      {REVIEW_C
        ? null
        : DIRECTIONS.map((d) => (
            <Link key={d.id} href={screenHref(d.id, screen ?? "player", player)} style={d.id === dir ? on : btn} title={d.name}>
              {d.letter}
            </Link>
          ))}
      {REVIEW_C ? null : <span style={{ width: 1, height: 18, background: "#3a3a3a" }} />}
      {SCREENS.map((s) => (
        <Link key={s.id} href={screenHref(dir ?? "c-collectible", s.id, player)} style={s.id === screen ? on : btn}>
          {s.name}
        </Link>
      ))}
      <span style={{ width: 1, height: 18, background: "#3a3a3a" }} />
      {MOMENTS.map((m) => (
        <button key={m.id} type="button" style={btn} title={m.hint} disabled={!!busy} onClick={() => void pin(m.id)}>
          {busy === m.id ? "Setting…" : m.label}
        </button>
      ))}
      <button type="button" style={pinned ? on : btn} onClick={() => (pinned ? releaseMoment(client) : client.setPinned(true))} title="Hold or release the current moment">
        {pinned ? `Pinned · ${phase.data ?? ""}` : "Running"}
      </button>
      <button type="button" aria-label="Hide lab bar" style={{ ...btn, border: "none" }} onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}
