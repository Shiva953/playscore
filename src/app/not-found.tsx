import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist. The player may not be listed yet.</p>
      <Button asChild variant="outline">
        <Link href="/markets">Back to markets</Link>
      </Button>
    </div>
  );
}
