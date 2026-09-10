import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { Avatar } from '../../components/design-system/Avatar';
import { SkeletonRows } from '../../components/design-system/Skeleton';
import { useToast } from '../../components/design-system/Toast';
import { relativeFromNow } from '../../lib/format';

export interface Contact {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycle: 'lead' | 'prospect' | 'customer' | 'partner' | 'archived';
  source: string | null;
  companyId: string | null;
  companyName?: string | null;
  ownerId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, isFetching, error, refetch } = useQuery({
    queryKey: ['contacts', search, page],
    queryFn: () =>
      api.get<Page<Contact>>(
        `/api/v1/contacts?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Personas</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Contactos</h1>
          {data && data.total > 0 && <p className="text-[12px] text-ink-500 mt-0.5">{data.total} en total</p>}
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>
          Nueva persona
        </Button>
      </header>

      <div className="card p-3 mb-4">
        <Input
          placeholder="Buscar por nombre, email, teléfono o cargo"
          defaultValue={search}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('q', e.target.value);
            else next.delete('q');
            next.set('page', '1');
            setParams(next);
          }}
          aria-label="Buscar personas"
        />
      </div>

      {isLoading && !data && <SkeletonRows rows={8} />}

      {isError && !isLoading && (
        <div className="card p-6 text-center">
          <p className="text-sm text-signal-bad mb-2">No se pudo cargar la lista.</p>
          <p className="text-[12px] text-ink-500 mb-3">{(error as ApiClientError)?.message ?? 'Error desconocido'}</p>
          <Button variant="outline" onClick={() => refetch()} loading={isFetching}>Reintentar</Button>
        </div>
      )}

      {data && data.items.length === 0 && !isLoading && !isError && (
        <EmptyState
          title={search ? 'Sin resultados' : 'Aún no tienes personas'}
          description={search ? 'Prueba con otro término o crea una nueva.' : 'Empieza creando tu primer contacto o importando un CSV.'}
          action={
            <Button variant="accent" onClick={() => setCreateOpen(true)}>
              Crear persona
            </Button>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          {/* Desktop */}
          <div className="card overflow-hidden hidden md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Empresa</th>
                  <th>Email</th>
                  <th>Ciclo</th>
                  <th className="text-right">Actividad</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/contacts/${c.id}`} className="flex items-center gap-3">
                        <Avatar name={c.fullName} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-900 truncate">{c.fullName}</p>
                          {c.jobTitle && <p className="text-[11px] text-ink-500 truncate">{c.jobTitle}</p>}
                        </div>
                      </Link>
                    </td>
                    <td className="text-ink-700">
                      {c.companyId ? (
                        <Link to={`/companies/${c.companyId}`} className="hover:underline">
                          {c.companyName ?? 'Ver empresa'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-ink-700">{c.email ?? '—'}</td>
                    <td>
                      <Badge tone={c.lifecycle === 'customer' ? 'ok' : c.lifecycle === 'prospect' ? 'lime' : 'neutral'}>
                        {c.lifecycle}
                      </Badge>
                    </td>
                    <td className="text-right text-[12px] text-ink-500">{relativeFromNow(c.lastActivityAt ?? c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <ul className="md:hidden space-y-2">
            {data.items.map((c) => (
              <li key={c.id} className="card p-3">
                <Link to={`/contacts/${c.id}`} className="flex items-center gap-3">
                  <Avatar name={c.fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900 truncate">{c.fullName}</p>
                    <p className="text-[11px] text-ink-500 truncate">
                      {[c.jobTitle, c.companyName].filter(Boolean).join(' · ') || c.email || '—'}
                    </p>
                  </div>
                  <Badge tone={c.lifecycle === 'customer' ? 'ok' : c.lifecycle === 'prospect' ? 'lime' : 'neutral'}>
                    {c.lifecycle}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-600">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('page', String(Math.max(1, page - 1)));
              setParams(next);
            }}
          >
            Anterior
          </Button>
          <span>Página {page} de {data.totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('page', String(page + 1));
              setParams(next);
            }}
          >
            Siguiente
          </Button>
        </div>
      )}

      <CreateContactModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export interface CreateContactModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-links the new person to a company, e.g. when opened from a Company record. */
  companyId?: string;
  companyName?: string;
  /** Extra query keys to invalidate on success (e.g. ['company-contacts', id]). */
  extraInvalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

export function CreateContactModal({ open, onClose, companyId, companyName, extraInvalidateKeys }: CreateContactModalProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [lifecycle, setLifecycle] = useState<Contact['lifecycle']>('lead');
  const [note, setNote] = useState('');
  const [forceShowCompany, setForceShowCompany] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const [companyQuery, setCompanyQuery] = useState('');

  const companies = useQuery({
    queryKey: ['companies-min', companyQuery],
    queryFn: () => api.get<Page<CompanyLite>>(`/api/v1/companies?pageSize=10${companyQuery ? `&search=${encodeURIComponent(companyQuery)}` : ''}`),
    enabled: open && !companyId && forceShowCompany,
  });
  const [pickedCompanyId, setPickedCompanyId] = useState('');

  const effectiveCompanyId = companyId ?? pickedCompanyId;
  const effectiveCompanyName = companyId ? companyName : companies.data?.items.find((c) => c.id === pickedCompanyId)?.name;

  const create = useMutation({
    mutationFn: async () =>
      api.post<{ id: string }>('/api/v1/contacts', {
        fullName,
        email: email || undefined,
        phone: phone || undefined,
        jobTitle: jobTitle || undefined,
        lifecycle,
        ...(effectiveCompanyId ? { companyId: effectiveCompanyId } : {}),
      }),
    onSuccess: async (res) => {
      toast.push({ tone: 'ok', title: 'Persona creada', body: fullName });
      if (note) {
        await api.post('/api/v1/notes', { subjectType: 'contact', subjectId: res.id, body: note }).catch(() => undefined);
      }
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
      for (const key of extraInvalidateKeys ?? []) {
        void qc.invalidateQueries({ queryKey: key });
      }
      onClose();
      setFullName(''); setEmail(''); setPhone(''); setJobTitle(''); setNote(''); setPickedCompanyId('');
    },
    onError: (err) => {
      const e = err as ApiClientError;
      toast.push({ tone: 'bad', title: 'No se pudo crear', body: e.message });
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={effectiveCompanyName ? `Nueva persona · ${effectiveCompanyName}` : 'Nueva persona'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="accent"
            onClick={() => create.mutate()}
            disabled={!fullName || create.isPending}
            loading={create.isPending}
          >
            Crear persona
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre completo" error={!fullName ? 'Obligatorio' : undefined}>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Cargo">
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <Field label="Ciclo de vida">
          <select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value as Contact['lifecycle'])}
            className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm"
          >
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="customer">Cliente</option>
            <option value="partner">Partner</option>
            <option value="archived">Archivado</option>
          </select>
        </Field>
        {!companyId && (
          <div className="sm:col-span-2">
            {!forceShowCompany ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setForceShowCompany(true)}>
                + Vincular a una empresa
              </Button>
            ) : (
              <Field label="Empresa">
                <Input placeholder="Buscar empresa…" value={companyQuery} onChange={(e) => setCompanyQuery(e.target.value)} />
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-ink-200 divide-y divide-ink-100">
                  {(companies.data?.items ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPickedCompanyId(c.id === pickedCompanyId ? '' : c.id)}
                      className={
                        'w-full text-left px-3 py-1.5 text-sm hover:bg-ink-50 ' +
                        (pickedCompanyId === c.id ? 'bg-ink-100 font-medium' : '')
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                  {companies.data && companies.data.items.length === 0 && (
                    <p className="px-3 py-2 text-[12px] text-ink-500">Sin coincidencias.</p>
                  )}
                </div>
              </Field>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <Field label="Nota inicial (opcional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contexto, de dónde vino, qué habló…" />
        </Field>
      </div>
    </Modal>
  );
}

interface CompanyLite {
  id: string;
  name: string;
}