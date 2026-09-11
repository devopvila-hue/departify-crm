import clsx from 'clsx';

/**
 * Skeleton — layout-preserving loading placeholder.
 *
 * Used instead of a bare "Cargando…" so the page keeps its shape while
 * data arrives (no white flash, no jump when the list appears).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-ink-100', className)} aria-hidden />;
}

/** A stack of table-row-like skeletons, for list/table loading states. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('card divide-y divide-ink-100 overflow-hidden', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="size-7 rounded-full shrink-0" />
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="ml-auto h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** A row of KPI-tile skeletons, matching the summary grid. */
export function SkeletonTiles({ tiles = 5 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-3 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}