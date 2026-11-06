import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PLAYERS, PLAYERS_BY_ID } from "@score/core";
import { TradeTerminal } from "@/components/trade/terminal";

export function generateStaticParams() {
  return PLAYERS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = PLAYERS_BY_ID[id];
  return { title: p ? `Trade $${p.ticker}` : "Trade" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PLAYERS_BY_ID[id]) notFound();
  return <TradeTerminal id={id} />;
}
