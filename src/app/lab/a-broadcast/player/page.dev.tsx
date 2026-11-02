import { APlayer } from "@/directions/a-broadcast/player";

export default async function Page({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player = "kane" } = await searchParams;
  return <APlayer id={player} />;
}
