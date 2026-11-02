import * as React from "react"
import { cn } from "@/lib/utils"

/** Inset field: darker than the card it sits on, 1px control edge, white focus edge. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-control bg-ground px-3 text-[15px] text-ink transition-[border-color] duration-150 outline-none placeholder:text-faint focus-visible:border-ink focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-down",
        className
      )}
      {...props}
    />
  )
}

export { Input }
