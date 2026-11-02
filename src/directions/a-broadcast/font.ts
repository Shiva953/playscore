import { Archivo } from "next/font/google";

/** One family: condensed widths for names and figures, normal width for text. */
export const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--a-font", display: "swap" });
