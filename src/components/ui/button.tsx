import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/**
 * Pills only. Primary is an inverted white pill: one per screen. `buy`/`sell` are the trade ticket's
 * actions only, in the side's colour; nothing else uses them.
 * Press scales to 0.96 over 150ms (better-ui); never when disabled. Hover compiles under (hover: hover).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent text-sm font-medium whitespace-nowrap outline-none transition-[transform,background-color,color,opacity] duration-150 ease-out-strong motion-safe:enabled:active:scale-[0.96] motion-safe:[a]:active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-down [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-ink text-ground hover:bg-ink-hover",
        secondary: "bg-raised text-ink hover:bg-raised-hover",
        outline: "border-control bg-transparent text-ink hover:bg-raised",
        ghost: "bg-transparent text-soft hover:bg-raised hover:text-ink aria-expanded:bg-raised aria-expanded:text-ink",
        destructive: "bg-down-tint text-down hover:bg-down-tint/80",
        /* The trade ticket's two actions carry their side's colour, as on every trading app (8 Nov). */
        // Disabled keeps the side readable as a tint instead of fading the fill to mud.
        buy: "bg-up font-semibold text-ground hover:bg-up-hover disabled:bg-up-tint disabled:text-up/60 disabled:opacity-100",
        sell: "bg-down font-semibold text-ground hover:bg-down-hover disabled:bg-down-tint disabled:text-down/60 disabled:opacity-100",
        link: "h-auto rounded-none px-0 text-ink underline decoration-control underline-offset-4 hover:decoration-ink",
      },
      size: {
        default: "h-9 px-4",
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-3 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5 text-[0.9375rem]",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
