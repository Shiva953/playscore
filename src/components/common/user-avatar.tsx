"use client";

import Avatar from "boring-avatars";
import { cn } from "@/lib/utils";

/** Bright colours from D's palette and around it (lime, pink, blue, amber, lilac), so faces stand out on black. */
const PALETTE = ["#c6ff3d", "#ff6b81", "#6ea8ff", "#ffb547", "#b9a3ff"];

/**
 * A generated avatar for a wallet: the same address always gets the same face (boring-avatars "beam").
 * Decorative: the name or address beside it carries the meaning.
 */
export function UserAvatar({ seed, size = 32, className }: { seed: string; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 overflow-hidden rounded-full", className)} style={{ width: size, height: size }}>
      {/* size-full also keeps menu items' "icons are 16px" rule off the avatar. */}
      <Avatar name={seed} variant="beam" colors={PALETTE} size={size} className="size-full" />
    </span>
  );
}
