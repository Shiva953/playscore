import { cn } from "@/lib/utils"

/**
 * The three marks a transaction can show, drawn in the text colour of whatever holds them.
 * Motion lives in globals.css (`.spinner`, `.status-draw`): the ring turns while it works, the tick and
 * the cross draw themselves once. Under reduced motion they appear finished.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn("spinner size-4 shrink-0", className)} aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" opacity="0.22" />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** `ring`: a circle draws round the tick first (the big confirmations). Without it, the tick alone (buttons, toasts). */
function CheckDraw({ className, ring = false, ...props }: React.ComponentProps<"svg"> & { ring?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn("status-draw size-4 shrink-0", className)} aria-hidden="true" {...props}>
      {ring ? <circle className="ring" cx="8" cy="8" r="7" pathLength={1} stroke="currentColor" strokeWidth="1.25" opacity="0.45" transform="rotate(-90 8 8)" /> : null}
      <path className="mark" d={ring ? "M4.9 8.3l2.1 2.1 4.1-4.5" : "M3.5 8.4l2.9 2.9 6.1-6.6"} pathLength={1} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossDraw({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn("status-draw size-4 shrink-0", className)} aria-hidden="true" {...props}>
      <path className="mark" d="M4.5 4.5l7 7" pathLength={1} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path className="mark" d="M11.5 4.5l-7 7" pathLength={1} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export { Spinner, CheckDraw, CrossDraw }
