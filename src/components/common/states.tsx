"use client";

import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/protocol/errors";
import { useUi } from "@/lib/protocol/react/ui-store";
import { cn } from "@/lib/utils";

export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm", className)} data-state="empty">
      <p className="font-medium">{title}</p>
      {children ? <div className="text-muted-foreground">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 rounded-lg border border-destructive/40 p-4 text-sm", className)} data-state="error">
      <p className="font-medium">Couldn&apos;t load this.</p>
      <p className="text-muted-foreground">{errorMessage(error)}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy="true" aria-label="Loading" data-state="loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function LoadingBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return <Skeleton className={cn("h-40 w-full", className)} style={style} aria-busy="true" aria-label="Loading" data-state="loading" />;
}

export function SignedOutState({ title = "Sign in to see this", children }: { title?: string; children?: ReactNode }) {
  const openSignIn = useUi((s) => s.openSignIn);
  return (
    <EmptyState title={title} action={<Button onClick={openSignIn}>Sign in</Button>}>
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
