import type { Metadata } from "next";
import { LabIndex } from "@/directions/lab/lab-index";

export const metadata: Metadata = { title: "Design lab" };

export default function LabPage() {
  return <LabIndex />;
}
