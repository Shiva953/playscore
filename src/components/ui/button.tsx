import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/**
 * Pills only (DESIGN.md §6). Primary is an inverted white pill: one per screen.
 * Press scales to 0.96 over 150ms (better-ui); never when disabled. Hover compiles under (hover: hover).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent text-sm font-medium whitespace-nowrap outline-none select-none transition-[transform,background-color,color,opacity] duration-150 ease-out-strong enabled:active:scale-[0.96] [a]:active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-down [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-ink text-black hover:bg-[#e6e6e6]",
        secondary: "bg-raised text-ink hover:bg-[#333333]",
        outline: "border-control bg-transparent text-ink hover:bg-raised",
        ghost: "bg-transparent text-soft hover:bg-raised hover:text-ink aria-expanded:bg-raised aria-expanded:text-ink",
        destructive: "bg-down-tint text-down hover:bg-[#3a1a20]",
        link: "h-auto rounded-none px-0 text-ink underline decoration-control underline-offset-4 hover:decoration-ink",
      },
      size: {
        default: "h-9 px-4",
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5 text-[15px]",
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
