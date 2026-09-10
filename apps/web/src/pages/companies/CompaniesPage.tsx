import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { SkeletonRows } from '../../components/design-system/Skeleton';
import { useToast } from '../../components/design-system/Toast';
import { formatShortDate, eur } from '../../lib/format';

type SortKey = 'name' | 'created_at';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'active' | 'inactive' | 'archived';

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  status: 'active' | 'inactive' | 'archived';
  contactsCount?: number;
  dealsCount?: number;
  dealsValueMinor?: number;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 25;

export function CompaniesPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const status = (params.get('status') as StatusFilter) || 'all';
  const sort = (params.get('sort') as SortKey) || 'created_at';
  const order = (params.get('order') as SortDir) || 'desc';
  const page = Math.max(1, Number(params.get('page') || 1));

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);

  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('pageSize', String(PAGE_SIZE));
  if (search) qs.set('search', search);
  if (status !== 'all') qs.set('status', status);
  if (sort) qs.set('sort', sort);
  if (order) qs.set('order', order);
  const url = `/api/v1/companies?${qs.toString()}`;

  const q = useQuery({
    queryKey: ['companies', { q: search, status, sort, order, page }],
    queryFn: () => api.get<Page<Company>>(url),
    placeholderData: (prev) => prev,
  });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: true });
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setParam('order', order === 'asc' ? 'desc' : 'asc');
    } else {
      setParam('sort', key);
      setParam('order', 'asc');
    }
  }

  const total = q.data?.total ?? 0;
  const totalPages = q.data?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = search !== '' || status !== 'all';

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Empresas</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Cuentas</h1>
          {total > 0 && <p className="text-[12px] text-ink-500 mt-0.5">{total} en total</p>}
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Nueva empresa</Button>
      </header>

      <div className="card p-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          placeholder="Buscar por nombre, dominio, ciudad o sector"
          defaultValue={search}
          onChange={(e) => setParam('q', e.target.value || null)}
          aria-label="Buscar empresas"
        />
        <select
          value={status}
          onChange={(e) => setParam('status', e.target.value === 'all' ? null : e.target.value)}
          className="h-9 rounded-md border border-ink-200 bg-white px-3 text-sm sm:w-44"
          aria-label="Filtrar por estado"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
          <option value="archived">Archivadas</option>
        </select>
      </div>

      {q.isLoading && <SkeletonRows rows={8} />}

      {q.isError && !q.isLoading && (
        <div className="card p-6 text-center">
          <p className="text-sm text-signal-bad mb-2">No se pudieron cargar las empresas.</p>
          <p className="text-[12px] text-ink-500 mb-3">{(q.error as Error)?.message ?? 'Error desconocido'}</p>
          <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}>Reintentar</Button>
        </div>
      )}

      {q.data && q.data.items.length === 0 && !q.isLoading && !q.isError && (
        <EmptyState
          title={hasFilters ? 'Sin resultados' : 'Sin empresas'}
          description={
            hasFilters
              ? 'No hay empresas que coincidan con la búsqueda o el filtro.'
              : 'Crea la primera para empezar a clasificar tus cuentas.'
          }
          action={
            !hasFilters ? (
              <Button variant="accent" onClick={() => setCreateOpen(true)}>Crear empresa</Button>
            ) : (
              <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Limpiar filtros
              </Button>
            )
          }
        />
      )}

      {q.data && q.data.items.length > 0 && (
        <>
          {/* Desktop: operational table */}
          <div className="card overflow-hidden hidden md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-ink-900">
                      Empresa <SortIndicator active={sort === 'name'} dir={order} />
                    </button>
                  </th>
                  <th className="hidden lg:table-cell">Sector</th>
                  <th className="text-right">Personas</th>
                  <th className="text-right">Oportunidades</th>
                  <th className="text-right">Valor abierto</th>
                  <th>Estado</th>
                  <th className="hidden lg:table-cell">
                    <button type="button" onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-ink-900">
                      Creada <SortIndicator active={sort === 'created_at'} dir={order} />
                    </button>
                  </th>
                  <th className="w-24"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/companies/${c.id}`} className="block">
                        <p className="text-sm font-medium text-ink-900">{c.name}</p>
                        {c.domain && <p className="text-[11px] text-ink-500">{c.domain}</p>}
                      </Link>
                    </td>
                    <td className="hidden lg:table-cell text-ink-700">{c.industry ?? '—'}</td>
                    <td className="text-right num text-ink-700">{c.contactsCount ?? 0}</td>
                    <td className="text-right num text-ink-700">{c.dealsCount ?? 0}</td>
                    <td className="text-right money text-ink-800">
                      {c.dealsValueMinor ? eur.format(c.dealsValueMinor / 100) : '—'}
                    </td>
                    <td>
                      <Badge tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status}</Badge>
                    </td>
                    <td className="hidden lg:table-cell text-right text-[12px] text-ink-500">{formatShortDate(c.createdAt)}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditTarget(c)}>Editar</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: the table pattern adapted to cards */}
          <ul className="md:hidden space-y-2">
            {q.data.items.map((c) => (
              <li key={c.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/companies/${c.id}`} className="min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{c.name}</p>
                    {c.domain && <p className="text-[11px] text-ink-500 truncate">{c.domain}</p>}
                  </Link>
                  <Badge tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-600">
                  <span>{c.contactsCount ?? 0} personas</span>
                  <span>{c.dealsCount ?? 0} oportunidades</span>
                  {c.dealsValueMinor ? <span className="money">{eur.format(c.dealsValueMinor / 100)}</span> : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between mt-3 text-[12px] text-ink-500">
            <span>Página {page} de {totalPages}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>Anterior</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>Siguiente</Button>
            </div>
          </div>
        </>
      )}

      <CreateCompanyModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editTarget && <EditCompanyModal company={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-ink-300">↕</span>;
  return <span className="text-ink-700">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export function CreateCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [country, setCountry] = useState('ES');
  const [city, setCity] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/api/v1/companies', { name, domain: domain || undefined, industry: industry || undefined, country, city: city || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
      toast.push({ tone: 'ok', title: 'Empresa creada', body: name });
      onClose();
      setName(''); setDomain(''); setIndustry(''); setCity('');
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva empresa"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => create.mutate()} disabled={!name || create.isPending} loading={create.isPending}>Crear</Button>
        </>
      }
    >
      <CompanyFields
        values={{ name, domain, industry, country, city }}
        onChange={(p) => {
          if (p.name !== undefined) setName(p.name ?? '');
          if (p.domain !== undefined) setDomain(p.domain ?? '');
          if (p.industry !== undefined) setIndustry(p.industry ?? '');
          if (p.country !== undefined) setCountry(p.country ?? '');
          if (p.city !== undefined) setCity(p.city ?? '');
        }}
        autoFocus
      />
    </Modal>
  );
}

export function EditCompanyModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [name, setName] = useState(company.name);
  const [domain, setDomain] = useState(company.domain ?? '');
  const [industry, setIndustry] = useState(company.industry ?? '');
  const [country, setCountry] = useState(company.country ?? 'ES');
  const [city, setCity] = useState(company.city ?? '');
  const [status, setStatus] = useState(company.status);
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/companies/${company.id}`, {
        name,
        domain: domain || null,
        industry: industry || null,
        country,
        city: city || null,
        status,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['company', company.id] });
      toast.push({ tone: 'ok', title: 'Empresa actualizada' });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar ${company.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => update.mutate()} disabled={!name || update.isPending} loading={update.isPending}>Guardar</Button>
        </>
      }
    >
      <CompanyFields
        values={{ name, domain, industry, country, city, status }}
        onChange={(p) => {
          if (p.name !== undefined) setName(p.name ?? '');
          if (p.domain !== undefined) setDomain(p.domain ?? '');
          if (p.industry !== undefined) setIndustry(p.industry ?? '');
          if (p.country !== undefined) setCountry(p.country ?? '');
          if (p.city !== undefined) setCity(p.city ?? '');
          if (p.status !== undefined) setStatus(p.status as Company['status']);
        }}
        showStatus
        autoFocus
      />
    </Modal>
  );
}

function CompanyFields({
  values,
  onChange,
  showStatus,
  autoFocus,
}: {
  values: Partial<Company>;
  onChange: (patch: Partial<Company>) => void;
  showStatus?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Nombre"><Input value={values.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} autoFocus={autoFocus} /></Field>
      <Field label="Dominio"><Input value={values.domain ?? ''} onChange={(e) => onChange({ domain: e.target.value })} placeholder="empresa.com" /></Field>
      <Field label="Sector"><Input value={values.industry ?? ''} onChange={(e) => onChange({ industry: e.target.value })} /></Field>
      <Field label="País"><Input value={values.country ?? ''} onChange={(e) => onChange({ country: e.target.value })} /></Field>
      <Field label="Ciudad"><Input value={values.city ?? ''} onChange={(e) => onChange({ city: e.target.value })} /></Field>
      {showStatus && (
        <Field label="Estado">
          <select
            value={values.status ?? 'active'}
            onChange={(e) => onChange({ status: e.target.value as Company['status'] })}
            className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm"
          >
            <option value="active">Activa</option>
            <option value="inactive">Inactiva</option>
            <option value="archived">Archivada</option>
          </select>
        </Field>
      )}
    </div>
  );
}