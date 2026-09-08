import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Badge } from '../../components/design-system/Badge';
import { Button } from '../../components/design-system/Button';
import { EmptyState } from '../../components/design-system/EmptyState';
import { formatDate, formatShortDate } from '../../lib/format';
import { CreateTaskModal } from '../tasks/TasksPage';

interface Company {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  source: string | null;
  status: 'active' | 'inactive' | 'archived';
  customValues: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Contact {
  id: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
  lifecycle: string;
}

interface Deal {
  id: string;
  name: string;
  status: 'open' | 'won' | 'lost';
  valueMinor: number;
  currency: string;
  stageId: string;
  stageName?: string | null;
}

interface Task {
  id: string;
  title: string;
  status: 'open' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueAt: string | null;
}

interface Activity {
  id: string;
  type: 'note' | 'email' | 'call' | 'meeting' | 'task' | 'status_change' | 'deal_change' | 'sequence_event' | 'system_event';
  subjectType: 'contact' | 'company' | 'deal' | 'organization';
  subjectId: string;
  actorId: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function CompanyDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  const company = useQuery({
    queryKey: ['company', id],
    queryFn: () => api.get<Company>(`/api/v1/companies/${id}`),
    enabled: !!id,
  });

  const contacts = useQuery({
    queryKey: ['company-contacts', id],
    queryFn: () => api.get<Page<Contact>>(`/api/v1/contacts?pageSize=100&companyId=${encodeURIComponent(id)}`),
    enabled: !!id && !!company.data,
    placeholderData: (prev) => prev,
  });

  const deals = useQuery({
    queryKey: ['company-deals', id],
    queryFn: () => api.get<Page<Deal>>(`/api/v1/deals?pageSize=100&companyId=${encodeURIComponent(id)}`),
    enabled: !!id && !!company.data,
    placeholderData: (prev) => prev,
  });

  const tasks = useQuery({
    queryKey: ['company-tasks', id],
    queryFn: () => api.get<Page<Task>>(`/api/v1/tasks?pageSize=100&subjectType=company&subjectId=${encodeURIComponent(id)}`),
    enabled: !!id && !!company.data,
    placeholderData: (prev) => prev,
  });

  const activities = useQuery({
    queryKey: ['company-activities', id],
    queryFn: () => api.get<Page<Activity>>(`/api/v1/activities?pageSize=50&subjectType=company&subjectId=${encodeURIComponent(id)}`),
    enabled: !!id && !!company.data,
    placeholderData: (prev) => prev,
  });

  if (company.isLoading) {
    return <p className="px-4 sm:px-8 py-6 text-sm text-ink-500">Cargando empresa…</p>;
  }
  if (company.isError || !company.data) {
    return <p className="px-4 sm:px-8 py-6 text-sm text-signal-bad">No se pudo cargar la empresa.</p>;
  }

  const c = company.data;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <Link to="/companies" className="text-[12px] text-ink-500 hover:text-ink-800">← Empresas</Link>

      {/* Identity header */}
      <header className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink-900 truncate">{c.name}</h1>
          <p className="text-sm text-ink-500 truncate">{c.website ?? c.domain ?? '—'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status}</Badge>
            {c.industry && <Badge tone="neutral">{c.industry}</Badge>}
            {c.country && <Badge tone="neutral">{c.country}</Badge>}
            {c.city && <Badge tone="neutral">{c.city}</Badge>}
            {c.size && <Badge tone="neutral">{c.size} pers.</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-ink-500">
          <p>Creada {formatDate(c.createdAt)}</p>
          {c.source && <p className="mt-0.5">Fuente: {c.source}</p>}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Identity card */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Identidad</h2>
          <dl className="text-sm space-y-2">
            <Row label="Nombre" value={c.name} />
            <Row label="Dominio" value={c.domain ?? '—'} />
            <Row label="Web" value={c.website ?? '—'} href={c.website ?? undefined} />
            <Row label="Sector" value={c.industry ?? '—'} />
            <Row label="Tamaño" value={c.size ?? '—'} />
            <Row label="País" value={c.country ?? '—'} />
            <Row label="Ciudad" value={c.city ?? '—'} />
            <Row label="Dirección" value={c.address ?? '—'} />
            <Row label="Teléfono" value={c.phone ?? '—'} />
          </dl>
        </section>

        {/* Right column: People, Deals, Tasks, Activity */}
        <div className="lg:col-span-2 space-y-4">
          {/* People */}
          <section className="card p-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-900">Personas</h2>
              <span className="text-[12px] text-ink-500">{contacts.data?.items.length ?? 0} vinculadas</span>
            </header>
            {contacts.isLoading && <p className="text-[12px] text-ink-500">Cargando…</p>}
            {contacts.data && contacts.data.items.length === 0 && (
              <EmptyState
                title="Sin personas vinculadas"
                description="Aún no hay contactos asignados a esta empresa."
              />
            )}
            {contacts.data && contacts.data.items.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {contacts.data.items.map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/contacts/${p.id}`} className="block">
                        <p className="text-sm font-medium text-ink-900 truncate">{p.fullName}</p>
                        <p className="text-[11px] text-ink-500 truncate">
                          {[p.jobTitle, p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </Link>
                    </div>
                    <Badge tone={p.lifecycle === 'customer' ? 'ok' : 'neutral'}>{p.lifecycle}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Deals */}
          <section className="card p-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-900">Oportunidades</h2>
              <span className="text-[12px] text-ink-500">{deals.data?.items.length ?? 0} en pipeline</span>
            </header>
            {deals.isLoading && <p className="text-[12px] text-ink-500">Cargando…</p>}
            {deals.data && deals.data.items.length === 0 && (
              <EmptyState
                title="Sin oportunidades"
                description="Esta empresa aún no tiene deals en el pipeline."
              />
            )}
            {deals.data && deals.data.items.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {deals.data.items.map((d) => (
                  <li key={d.id} className="py-2.5 flex items-center justify-between gap-2">
                    <Link to={`/deals/${d.id}`} className="block min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{d.name}</p>
                      <p className="text-[11px] text-ink-500 truncate">
                        {d.stageName ?? d.stageId}
                      </p>
                    </Link>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-ink-900">
                        {formatMoney(d.valueMinor, d.currency)}
                      </p>
                      <Badge tone={d.status === 'won' ? 'ok' : d.status === 'lost' ? 'bad' : 'neutral'}>
                        {d.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tasks */}
          <section className="card p-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-900">Tareas</h2>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink-500">{tasks.data?.items.length ?? 0} abiertas</span>
                <Button size="sm" variant="outline" onClick={() => setTaskModalOpen(true)}>
                  Nueva tarea
                </Button>
              </div>
            </header>
            {tasks.isLoading && <p className="text-[12px] text-ink-500">Cargando…</p>}
            {tasks.data && tasks.data.items.length === 0 && (
              <EmptyState
                title="Sin tareas"
                description="No hay tareas vinculadas a esta empresa. Crea la primera desde la página de Tareas."
              />
            )}
            {tasks.data && tasks.data.items.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {tasks.data.items.map((t) => (
                  <li key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink-900 truncate">{t.title}</p>
                      <p className="text-[11px] text-ink-500">
                        {t.dueAt ? `Vence ${formatShortDate(t.dueAt)}` : 'Sin fecha'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {t.priority === 'urgent' ? <Badge tone="bad">Urgente</Badge>
                        : t.priority === 'high' ? <Badge tone="warn">Alta</Badge>
                        : <Badge tone="neutral">{t.priority}</Badge>}
                      {t.status === 'done' && <Badge tone="ok">Hecha</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Activity timeline */}
          <section className="card p-5">
            <header className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-900">Actividad</h2>
              <span className="text-[12px] text-ink-500">{activities.data?.items.length ?? 0} eventos</span>
            </header>
            {activities.isLoading && <p className="text-[12px] text-ink-500">Cargando…</p>}
            {activities.data && activities.data.items.length === 0 && (
              <EmptyState
                title="Sin actividad reciente"
                description="Aún no hay eventos registrados para esta empresa."
              />
            )}
            {activities.data && activities.data.items.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {activities.data.items.map((a) => (
                  <li key={a.id} className="py-2.5 flex items-start gap-3">
                    <ActivityTypeBadge type={a.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink-900 truncate">{a.title}</p>
                      {a.body && <p className="text-[12px] text-ink-500 line-clamp-2 mt-0.5">{a.body}</p>}
                      <p className="text-[11px] text-ink-400 mt-0.5">
                        {a.actorId ? 'Usuario' : 'Sistema'} · {formatShortDate(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <CreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        initialSubjectType="company"
        initialSubjectId={c.id}
        subjectLabel={c.name}
        extraInvalidateKeys={[['company-tasks', c.id]]}
      />
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-medium shrink-0">{label}</dt>
      <dd className="text-ink-800 text-right truncate min-w-0">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline truncate inline-block max-w-full">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function formatMoney(minor: number, currency: string): string {
  const major = (minor ?? 0) / 100;
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${major.toLocaleString('es-ES')} ${currency}`;
  }
}

// re-export Button import marker (used by sibling commits if needed)
void Button;

function ActivityTypeBadge({ type }: { type: Activity['type'] }) {
  const map: Record<Activity['type'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'lime' }> = {
    note: { label: 'Nota', tone: 'neutral' },
    email: { label: 'Email', tone: 'lime' },
    call: { label: 'Llamada', tone: 'lime' },
    meeting: { label: 'Reunión', tone: 'lime' },
    task: { label: 'Tarea', tone: 'neutral' },
    status_change: { label: 'Estado', tone: 'warn' },
    deal_change: { label: 'Deal', tone: 'ok' },
    sequence_event: { label: 'Secuencia', tone: 'neutral' },
    system_event: { label: 'Sistema', tone: 'neutral' },
  };
  const m = map[type] ?? { label: type, tone: 'neutral' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
