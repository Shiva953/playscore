import { Figtree, Unbounded } from "next/font/google";

/** Wide, rounded display for names and figures on the cards; a plain sans for everything you read. */
export const unbounded = Unbounded({ subsets: ["latin"], variable: "--c-display", display: "swap" });
export const figtree = Figtree({ subsets: ["latin"], variable: "--c-text", display: "swap" });
