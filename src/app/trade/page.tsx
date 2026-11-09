import { redirect } from "next/navigation";

/** The terminal opens on the first listing (ICO#1); the list on the left switches from there. */
export default function Page() {
  redirect("/trade/bellingham");
}
