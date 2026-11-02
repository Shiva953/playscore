import { CPlayer } from "@/directions/c-collectible/player";

export default async function Page({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player = "kane" } = await searchParams;
  return <CPlayer id={player} />;
}
