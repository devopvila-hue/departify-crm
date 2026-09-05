import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { eur, formatDate } from '../../lib/format';
import { Badge } from '../../components/design-system/Badge';
import { Avatar } from '../../components/design-system/Avatar';

interface Deal {
  id: string;
  name: string;
  stageId: string;
  pipelineId: string;
  valueMinor: number;
  currency: string;
  probability: number;
  status: 'open' | 'won' | 'lost';
  expectedCloseAt: string | null;
  source: string | null;
  companyId: string | null;
  updatedAt: string;
  createdAt: string;
  contacts: Array<{ id: string; fullName: string; email: string | null; jobTitle: string | null }>;
}

export function DealDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => api.get<Deal>(`/api/v1/deals/${id}`),
    enabled: !!id,
  });
  if (isLoading) return <p className="px-8 py-6 text-sm text-ink-500">Cargando…</p>;
  if (isError || !data) return <p className="px-8 py-6 text-sm text-signal-bad">No se pudo cargar el deal.</p>;
  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <Link to="/pipeline" className="text-[12px] text-ink-500 hover:text-ink-800">← Pipeline</Link>
      <header className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{data.name}</h1>
          <p className="money text-2xl font-semibold text-ink-800 mt-1">{eur.format(data.valueMinor / 100)}</p>
          <div className="mt-1.5 flex gap-1.5">
            <Badge tone={data.status === 'won' ? 'ok' : data.status === 'lost' ? 'bad' : 'neutral'}>
              {data.status === 'open' ? 'Abierto' : data.status === 'won' ? 'Ganado' : 'Perdido'}
            </Badge>
            {data.probability > 0 && <Badge tone="neutral">{data.probability}% probabilidad</Badge>}
            {data.expectedCloseAt && <Badge tone="neutral">Cierre {formatDate(data.expectedCloseAt)}</Badge>}
          </div>
        </div>
      </header>
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 card p-5">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Contactos vinculados</h2>
          {data.contacts.length === 0 ? (
            <p className="text-sm text-ink-500">Aún no hay contactos. Vincula al responsable de la cuenta desde la edición del deal.</p>
          ) : (
            <ul className="space-y-2">
              {data.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <Avatar name={c.fullName} />
                  <div>
                    <Link to={`/contacts/${c.id}`} className="text-sm text-ink-900 hover:underline">{c.fullName}</Link>
                    <p className="text-[11px] text-ink-500">{c.jobTitle ?? c.email ?? ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="card p-5">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Datos</h2>
          <dl className="text-sm space-y-2">
            <Row label="Origen" value={data.source ?? '—'} />
            <Row label="Creado" value={formatDate(data.createdAt)} />
            <Row label="Actualizado" value={formatDate(data.updatedAt)} />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</dt>
      <dd className="text-ink-800 text-right truncate">{value}</dd>
    </div>
  );
}
