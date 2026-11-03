"use client";

import { useEffect, useRef, useState } from "react";

/** Width of an element, kept current with a ResizeObserver (for hand-drawn SVG charts). */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const [ref, size] = useSize<T>(fallback, 0);
  return [ref, size.width] as const;
}

/** Width and height of an element (for layouts that fill the space they're given). */
export function useSize<T extends HTMLElement>(fallbackW = 640, fallbackH = 0) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: fallbackW, height: fallbackH });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.round(e!.contentRect.width), height: Math.round(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
