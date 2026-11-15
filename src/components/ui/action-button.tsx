"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { CheckDraw, CrossDraw, Spinner } from "@/components/ui/status"
import { cn } from "@/lib/utils"

/** Where an action is: at rest, working, landed, or failed. The same four names React Query gives a mutation. */
export type Phase = "idle" | "pending" | "success" | "error"

/**
 * A mutation's status as a phase that returns to rest by itself: "success" and "error" hold for a beat
 * (long enough to read the tick or the cross), then the mutation is reset and the control is ready again.
 */
export function usePhase(m: { status: Phase; reset: () => void }, { hold = 1500, errorHold = 2000 }: { hold?: number; errorHold?: number } = {}): Phase {
  const { status, reset } = m
  useEffect(() => {
    if (status !== "success" && status !== "error") return
    const t = setTimeout(reset, status === "success" ? hold : errorHold)
    return () => clearTimeout(t)
  }, [status, reset, hold, errorHold])
  return status
}

/**
 * A button that shows its action's state on itself instead of swapping its label for "Doing…":
 * the label gives way to a turning ring and the verb, then to a drawn tick and what happened (or a cross
 * and "try again"), and returns. Each label slides out as the next slides in (opacity, 8px, a 4px blur;
 * better-ui's swap, 300ms with no bounce). While it works it keeps its colour and ignores presses; it is
 * never `disabled` for being busy, so the fill doesn't fade to a tint mid-transaction.
 *
 * Every label is laid out in one grid cell, so the button is as wide as its longest state and never
 * changes size as it moves between them.
 */
export function ActionButton({
  phase,
  children,
  pending,
  success,
  error = "Didn't go through",
  className,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children"> & {
  phase: Phase
  /** The label at rest. */
  children: ReactNode
  /** The verb while it works ("Buying"): no ellipsis, the ring says it's working. */
  pending: ReactNode
  /** What happened ("Bought"). Falls back to the resting label with a tick. */
  success?: ReactNode
  error?: ReactNode
}) {
  const reduce = useReducedMotion()
  const busy = phase !== "idle"
  const face: Record<Phase, ReactNode> = {
    idle: children,
    pending: (
      <>
        <Spinner />
        {pending}
      </>
    ),
    success: (
      <>
        <CheckDraw />
        {success ?? children}
      </>
    ),
    error: (
      <>
        <CrossDraw />
        {error}
      </>
    ),
  }
  const row = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2"
  const away = reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }
  const from = reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }
  const here = reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }
  return (
    <Button
      {...props}
      data-phase={phase}
      aria-busy={phase === "pending" || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      className={cn(
        busy && "pointer-events-none",
        phase === "success" && "confirm-ring",
        phase === "error" && "nudge !bg-down-tint !text-down",
        className
      )}
    >
      <span className="grid items-center justify-items-center">
        {/* Sizers: every state, invisible, in the same cell. */}
        {(Object.keys(face) as Phase[]).map((k) => (
          <span key={k} aria-hidden="true" className={cn(row, "invisible")}>
            {face[k]}
          </span>
        ))}
        <AnimatePresence initial={false}>
          <motion.span
            key={phase}
            className={row}
            initial={from}
            animate={here}
            exit={away}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            aria-live={busy ? "polite" : undefined}
          >
            {face[phase]}
          </motion.span>
        </AnimatePresence>
      </span>
    </Button>
  )
}
