"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Rules and alignment: 12px grey sentence-case headers, no band, 44px rows over 1px rules.
 * When the table is wider than its box (a phone), the box scrolls sideways and becomes a keyboard stop
 * (tabIndex 0, a labelled region), so it can be scrolled without a pointer. Otherwise it's no tab stop.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const box = React.useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = React.useState(false)
  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={box}
      data-slot="table-container"
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? (props["aria-label"] ?? "Table, scrolls sideways") : undefined}
      className="relative w-full overflow-x-auto overscroll-x-contain rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <table data-slot="table" className={cn("num w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn(className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("font-medium [&>tr]:last:border-b-0", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-rule transition-colors duration-150 has-aria-expanded:bg-raised/40 data-[state=selected]:bg-raised", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-normal text-faint [&:not(:first-child)]:whitespace-nowrap first:pl-0 last:pr-0 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("h-11 px-3 align-middle [&:not(:first-child)]:whitespace-nowrap first:pl-0 last:pr-0 [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-4 text-sm text-faint", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
