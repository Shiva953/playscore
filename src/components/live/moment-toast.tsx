"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { PlayerAvatar } from "@/components/common/kit";
import { cn } from "@/lib/utils";

/**
 * A moment that is about you: your player scored, your order filled, your player bonded. Same surface as
 * every toast (raised, floating), with the player's kit and one figure, and a link to where it matters.
 */
export function momentToast({
  playerId,
  title,
  body,
  figure,
  tone = "up",
  href,
}: {
  playerId: string;
  title: string;
  body?: ReactNode;
  figure?: string;
  tone?: "up" | "down" | "ink";
  href?: string;
}) {
  toast.custom(
    (id) => (
      // taste-skill-ignore: a toast floats over the page, so it casts the overlay shadow.
      <div className="flex w-[356px] max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl bg-raised p-3 pr-4 text-ink shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] [--kit-ring:var(--raised)]">
        <PlayerAvatar id={playerId} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.875rem] font-medium">{title}</span>
          {body ? <span className="text-[0.8125rem] text-soft">{body}</span> : null}
          {href ? (
            <Link href={href} onClick={() => toast.dismiss(id)} className="mt-0.5 w-fit text-[0.8125rem] text-soft underline decoration-control underline-offset-4 hover:text-ink">
              Open
            </Link>
          ) : null}
        </div>
        {figure ? <span className={cn("fig shrink-0 text-[1.25rem] font-semibold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink")}>{figure}</span> : null}
      </div>
    ),
    { duration: 6_000 }
  );
}
