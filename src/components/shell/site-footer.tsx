import Link from "next/link";

/** A single quiet line (taste footer blueprint). */
export function SiteFooter() {
  return (
    <footer className="mb-16 md:mb-0">
      <div className="mx-auto grid w-full max-w-[1200px] gap-2 px-4 py-8 text-[13px] text-faint md:grid-cols-[1fr_auto_1fr] md:items-baseline md:px-6">
        <span>Devnet demo · test USDC and simulated match data · dividends are not guaranteed</span>
        <span className="flex gap-6">
          <Link href="/terms" className="text-soft hover:text-ink">
            Terms
          </Link>
          <Link href="/docs/stats" className="text-soft hover:text-ink">
            Docs
          </Link>
        </span>
        <span className="md:text-right">score · 2026</span>
      </div>
    </footer>
  );
}
