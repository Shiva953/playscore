"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Lets a block change height smoothly when its contents are swapped (the ticket's form for its receipt,
 * a dialog's review step for its confirmation), so what sits under it glides instead of jumping.
 * It measures the content and transitions to that height; height is the one layout property worth
 * animating here, because the alternative is a jump. It clips only while it moves, so focus rings and
 * anything that overhangs are untouched at rest. Under reduced motion the height just changes.
 */
export function AutoHeight({ children, className, innerClassName, ...rest }: { children: ReactNode; className?: string; innerClassName?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "style">) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const first = useRef(true);

  useIsoLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight;
      setHeight((prev) => {
        if (prev === next) return prev;
        // The first measurement sets the height without a transition; later ones move to it.
        if (!first.current && prev !== null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setMoving(true);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => setMoving(false), 340);
        }
        first.current = false;
        return next;
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      {...rest}
      className={cn(moving && "overflow-clip transition-[height] duration-300 ease-out-strong", className)}
      style={height === null ? undefined : { height }}
    >
      <div ref={inner} className={innerClassName}>{children}</div>
    </div>
  );
}
