import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { ActivityFeed, type ActivityItemData, type ActivityType } from '../../components/crm/ActivityFeed';

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 30;

const FILTERS: Array<{ value: ActivityType | 'all'; label: string }> = [
  { value: 'all', label: 'Todo' },
  { value: 'email', label: 'Emails' },
  { value: 'meeting', label: 'Reuniones' },
  { value: 'call', label: 'Llamadas' },
  { value: 'note', label: 'Notas' },
  { value: 'deal_change', label: 'Oportunidades' },
  { value: 'status_change', label: 'Etapas' },
  { value: 'task', label: 'Tareas' },
];

/**
 * Actividad — the chronological commercial memory.
 *
 * Every event recorded by the CRM (and, later, by email/calendar
 * integrations and by Departify itself) lands here. The tab is the
 * integration point for those systems: it renders what happened, on
 * which record, and who did it.
 */
export function ActivityPage() {
  const [type, setType] = useState<ActivityType | 'all'>('all');

  const query = useInfiniteQuery({
    queryKey: ['activities', type],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ page: String(pageParam), pageSize: String(PAGE_SIZE) });
      if (type !== 'all') qs.set('type', type);
      return api.get<Page<ActivityItemData>>(`/api/v1/activities?${qs.toString()}`);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    refetchInterval: 60_000,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1080px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Actividad</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Qué ha pasado en tu CRM</h1>
          <p className="text-sm text-ink-500 mt-1">
            {total > 0 ? `${total} eventos registrados` : 'La memoria comercial de tu equipo'}
          </p>
        </div>
      </header>

      <div className="card p-2 mb-4 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Filtrar actividad por tipo">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={type === f.value}
            onClick={() => setType(f.value)}
            className={
              'shrink-0 rounded-md px-3 h-8 text-[13px] font-medium transition-colors ' +
              (type === f.value ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {query.isError ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-signal-bad mb-2">No se pudo cargar la actividad.</p>
          <Button variant="outline" onClick={() => query.refetch()} loading={query.isFetching}>
            Reintentar
          </Button>
        </div>
      ) : (
        <ActivityFeed
          items={items}
          loading={query.isLoading}
          emptyTitle={type === 'all' ? 'Todavía no hay actividad' : 'Sin eventos de este tipo'}
          emptyDescription={
            type === 'all'
              ? 'Cuando muevas una oportunidad, añadas una nota o se registre un email, aparecerá aquí.'
              : 'Prueba con otro filtro para ver el resto de la actividad.'
          }
        />
      )}

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}