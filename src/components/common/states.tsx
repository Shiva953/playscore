"use client";

import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedSkeleton } from "@/components/common/skeletons";
import { errorMessage } from "@/lib/protocol/errors";
import { useUi } from "@/lib/protocol/react/ui-store";
import { cn } from "@/lib/utils";

export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-2xl border border-dashed border-control/70 px-5 py-4 text-sm", className)} data-state="empty">
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="max-w-prose text-soft">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl bg-surface ring-1 ring-edge ring-inset px-5 py-4 text-sm", className)} data-state="error">
      <span className="size-2 translate-y-[-1px] self-center rounded-full bg-down" aria-hidden="true" />
      <p className="text-ink">Couldn&apos;t load this.</p>
      <p className="text-soft">{errorMessage(error)}</p>
      {onRetry ? (
        <Button size="sm" variant="link" onClick={onRetry} className="ml-auto">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Rows that haven't loaded, drawn as rows: a face, two lines, a figure (see common/skeletons). */
export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return <FeedSkeleton rows={rows} className={className} />;
}

/** A single block whose insides aren't known yet. Prefer a skeleton from common/skeletons that draws the layout. */
export function LoadingBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" data-state="loading" className={cn("h-40 w-full", className)} style={style}>
      <Skeleton className="size-full rounded-2xl" />
    </div>
  );
}

export function SignedOutState({ title = "Sign in to see this", children }: { title?: string; children?: ReactNode }) {
  const openSignIn = useUi((s) => s.openSignIn);
  return (
    <EmptyState title={title} action={<Button variant="secondary" size="sm" onClick={openSignIn}>Sign in</Button>}>
      {children ?? "Sign in with Google, email or Phantom. Devnet only: you get 1,000 test USDC."}
    </EmptyState>
  );
}

/** Renders loading / error / empty / content for a query in one place. */
export function QueryState<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  loading?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <LoadingRows />}</>;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
