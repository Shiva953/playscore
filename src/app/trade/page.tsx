import { redirect } from "next/navigation";

/** The terminal opens on the flagship player; the list on the left switches from there. */
export default function Page() {
  redirect("/trade/kane");
}
