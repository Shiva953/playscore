import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mb-16 border-t md:mb-0">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground">
        <span>score · Devnet demo with simulated funds and mock match data. Dividends are not guaranteed.</span>
        <span className="flex gap-3">
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <Link href="/docs/stats" className="hover:underline">
            Docs
          </Link>
        </span>
      </div>
    </footer>
  );
}
