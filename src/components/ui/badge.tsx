import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/** Pills sit inside rows or beside a value, never above a heading. Pale pairs, never saturated fills. */
const badgeVariants = cva(
  "inline-flex h-5 w-fit flex-none shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-raised text-ink",
        secondary: "bg-raised text-soft",
        up: "bg-up-tint text-up",
        down: "bg-down-tint text-down",
        destructive: "bg-down-tint text-down",
        outline: "border border-control text-soft",
        ghost: "text-soft",
        link: "text-ink underline-offset-4 hover:underline",
        FWD: "bg-pos-fwd/14 text-pos-fwd",
        MID: "bg-pos-mid/14 text-pos-mid",
        DEF: "bg-pos-def/14 text-pos-def",
        GK: "bg-pos-gk/14 text-pos-gk",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
