import type { Metadata } from "next";
import { LaunchPage } from "@/components/launch/launch-page";

export const metadata: Metadata = { title: "Launch" };

export default async function Page({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  return <LaunchPage selected={p} />;
}
