import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { compactEur, eur, formatShortDate, relativeFromNow } from '../../lib/format';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';

interface AttentionResponse {
  generatedAt: string;
  summary: { openDeals: number; pipelineValueMinor: number; contactsTotal: number; companiesTotal: number; tasksOpen: number };
  overdueTasks: Array<{ id: string; title: string; dueAt: string; priority: string; subjectType: string; subjectId: string }>;
  todayTasks: Array<{ id: string; title: string; dueAt: string; priority: string }>;
  staleDeals: Array<{ id: string; name: string; valueMinor: number; currency: string; updatedAt: string }>;
  recentContacts: Array<{ id: string; fullName: string; email: string; lifecycle: string; createdAt: string }>;
}

export function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.get<AttentionResponse>('/api/v1/attention'),
    refetchInterval: 60_000,
  });

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Inicio</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">¿Qué necesita atención hoy?</h1>
          <p className="text-sm text-ink-500 mt-1">
            Una vista operacional. No un dashboard: cada bloque responde a una acción.
          </p>
        </div>
      </header>

      {isLoading && <div className="text-sm text-ink-500">Cargando…</div>}
      {isError && <EmptyState title="No se pudo cargar la información" description="Comprueba tu sesión e inténtalo de nuevo." />}

      {data && (
        <>
          {/* Summary tiles — restrained, single row. */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            <SummaryTile label="Pipeline abierto" value={data.summary.openDeals} />
            <SummaryTile label="Valor en pipeline" value={compactEur.format(data.summary.pipelineValueMinor / 100)} />
            <SummaryTile label="Contactos" value={data.summary.contactsTotal} />
            <SummaryTile label="Empresas" value={data.summary.companiesTotal} />
            <SummaryTile label="Tareas abiertas" value={data.summary.tasksOpen} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Overdue tasks */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-ink-900">Tareas vencidas</h2>
                <Link to="/tasks?overdue=1" className="text-[12px] text-ink-600 hover:text-ink-900">Ver todas</Link>
              </header>
              {data.overdueTasks.length === 0 ? (
                <p className="text-sm text-ink-500">Nada vencido. Buen trabajo.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.overdueTasks.map((t) => (
                    <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-900 truncate">{t.title}</p>
                        <p className="text-[11px] text-ink-500">
                          Vencida {relativeFromNow(t.dueAt)} · {formatShortDate(t.dueAt)}
                        </p>
                      </div>
                      {t.priority === 'urgent' ? <Badge tone="bad">Urgente</Badge> : <Badge tone="warn">{t.priority}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Today */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-ink-900">Para hoy</h2>
                <Link to="/tasks" className="text-[12px] text-ink-600 hover:text-ink-900">Ver todas</Link>
              </header>
              {data.todayTasks.length === 0 ? (
                <p className="text-sm text-ink-500">Sin tareas para hoy.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.todayTasks.map((t) => (
                    <li key={t.id} className="py-2.5">
                      <p className="text-sm text-ink-900 truncate">{t.title}</p>
                      <p className="text-[11px] text-ink-500">Vence {formatShortDate(t.dueAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Stale deals */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-ink-900">Oportunidades estancadas</h2>
                <Link to="/pipeline" className="text-[12px] text-ink-600 hover:text-ink-900">Ver pipeline</Link>
              </header>
              {data.staleDeals.length === 0 ? (
                <p className="text-sm text-ink-500">Nada estancado más de 14 días.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.staleDeals.map((d) => (
                    <li key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                      <Link to={`/deals/${d.id}`} className="min-w-0 hover:underline">
                        <p className="text-sm text-ink-900 truncate">{d.name}</p>
                        <p className="text-[11px] text-ink-500">Sin movimiento {relativeFromNow(d.updatedAt)}</p>
                      </Link>
                      <span className="money text-sm text-ink-800">{eur.format(d.valueMinor / 100)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Recent contacts */}
            <section className="card p-5">
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-ink-900">Contactos recientes</h2>
                <Link to="/contacts" className="text-[12px] text-ink-600 hover:text-ink-900">Ver todos</Link>
              </header>
              {data.recentContacts.length === 0 ? (
                <EmptyState
                  title="Aún no tienes contactos"
                  description="Importa una lista o crea el primero para empezar."
                  action={
                    <Link to="/contacts" className="btn-accent">
                      Crear contacto
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.recentContacts.map((c) => (
                    <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                      <Link to={`/contacts/${c.id}`} className="min-w-0 hover:underline">
                        <p className="text-sm text-ink-900 truncate">{c.fullName}</p>
                        <p className="text-[11px] text-ink-500 truncate">{c.email ?? '—'}</p>
                      </Link>
                      <Badge tone="neutral">{c.lifecycle}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900 num">{value}</p>
    </div>
  );
}
