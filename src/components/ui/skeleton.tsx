import { cn } from "@/lib/utils"

/**
 * A bone: one placeholder at the size, place and radius of the element it stands for (a 24px figure gets
 * a 24px bar, an avatar its tile, a pill its pill), so the page doesn't move when the data lands.
 * The fill and the sweep live in globals.css on `[data-slot="skeleton"]`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("rounded-md", className)} {...props} />
}

/**
 * A line of text that hasn't loaded. `size` is the text's font size class, so the bone takes that line's
 * height in the layout (keeping the rhythm) and draws a bar the height of its letters inside it.
 */
function TextBone({ className, width = "w-24" }: { className?: string; width?: string }) {
  return (
    <span className={cn("flex items-center", className)} aria-hidden="true">
      {/* The zero-width space gives the row its line height at the inherited font size. */}
      <span className="w-0 overflow-hidden">&#8203;</span>
      <span data-slot="skeleton" className={cn("block h-[0.72em] rounded-[0.24em]", width)} />
    </span>
  )
}

export { Skeleton, TextBone }
