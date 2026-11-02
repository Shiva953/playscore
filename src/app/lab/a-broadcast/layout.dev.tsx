import { AShell } from "@/directions/a-broadcast/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AShell>{children}</AShell>;
}
