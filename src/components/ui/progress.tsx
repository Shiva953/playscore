"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

/**
 * Thin track at the true ratio. `tone="brand"` (gold) is bonding progress toward $25k; `tone="up"` a gain;
 * the default fill is ink. The fill animates scale-x, not width.
 */
function Progress({
  className,
  value,
  tone = "ink",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { tone?: "ink" | "up" | "brand" | "soft" }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={v}
      className={cn("relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-raised", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-[600ms] motion-safe:ease-out-strong",
          tone === "up" ? "bg-up" : tone === "brand" ? "bg-brand" : tone === "soft" ? "bg-soft" : "bg-ink"
        )}
        style={{ transform: `scaleX(${v / 100})` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
