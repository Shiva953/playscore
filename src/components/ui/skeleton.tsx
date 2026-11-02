import { cn } from "@/lib/utils"

/** Flat grey bar at the content's real size. No pulse, no shimmer (taste app-screens §11). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("rounded-lg bg-raised/60", className)} {...props} />
}

export { Skeleton }
