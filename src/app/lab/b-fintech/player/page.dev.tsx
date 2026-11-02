import { BPlayer } from "@/directions/b-fintech/player";

export default async function Page({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player = "kane" } = await searchParams;
  return <BPlayer id={player} />;
}
