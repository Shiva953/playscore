import type { Metadata } from "next";
import { MatchdayPage } from "@/components/matchday/matchday-page";

export const metadata: Metadata = { title: "Matchday" };

export default function Page() {
  return <MatchdayPage />;
}
