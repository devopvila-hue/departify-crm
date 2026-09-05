import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge } from '../../components/design-system/Badge';
import { formatDate } from '../../lib/format';

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

export function CompanyDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['company', id],
    queryFn: () => api.get<Company>(`/api/v1/companies/${id}`),
    enabled: !!id,
  });
  if (isLoading) return <p className="px-8 py-6 text-sm text-ink-500">Cargando…</p>;
  if (isError || !data) return <p className="px-8 py-6 text-sm text-signal-bad">No se pudo cargar la empresa.</p>;
  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <Link to="/companies" className="text-[12px] text-ink-500 hover:text-ink-800">← Empresas</Link>
      <header className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{data.name}</h1>
          <p className="text-sm text-ink-500">{data.website ?? data.domain ?? '—'}</p>
          <div className="mt-1.5 flex gap-1.5">
            <Badge tone={data.status === 'active' ? 'ok' : 'neutral'}>{data.status}</Badge>
            {data.industry && <Badge tone="neutral">{data.industry}</Badge>}
            {data.country && <Badge tone="neutral">{data.country}</Badge>}
          </div>
        </div>
      </header>
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 card p-5">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Resumen</h2>
          <p className="text-sm text-ink-600">
            Aquí verás los contactos, oportunidades y timeline de esta cuenta. La pantalla completa de empresa con deals y actividad se entrega en el siguiente sprint.
          </p>
        </section>
        <aside className="card p-5">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Datos</h2>
          <dl className="text-sm space-y-2">
            <Row label="Sector" value={data.industry ?? '—'} />
            <Row label="Tamaño" value={data.size ?? '—'} />
            <Row label="País" value={data.country ?? '—'} />
            <Row label="Ciudad" value={data.city ?? '—'} />
            <Row label="Teléfono" value={data.phone ?? '—'} />
            <Row label="Creada" value={formatDate(data.createdAt)} />
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
