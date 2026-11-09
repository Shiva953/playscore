import { ArrowUpRight } from "lucide-react";
import { orbAddressUrl, orbTxUrl } from "@/lib/solana/explorer";
import { cn } from "@/lib/utils";

/** "View on Orb": opens the transaction (or address) in Orb, Helius's Solana explorer, in a new tab. */
export function OrbLink({ signature, address, children = "View on Orb", className }: { signature?: string; address?: string; children?: React.ReactNode; className?: string }) {
  const href = signature ? orbTxUrl(signature) : address ? orbAddressUrl(address) : null;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex w-fit items-center gap-1 text-soft underline decoration-control underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink", className)}
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
