import { CShell } from "@/directions/c-collectible/shell";
import { CPlayer } from "@/directions/c-collectible/player";

export default async function Page({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player = "kane" } = await searchParams;
  return (
    <CShell>
      <CPlayer id={player} />
    </CShell>
  );
}
