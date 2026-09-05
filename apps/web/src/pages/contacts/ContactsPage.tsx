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
import { useToast } from '../../components/design-system/Toast';
import { formatShortDate, relativeFromNow } from '../../lib/format';

interface Contact {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycle: 'lead' | 'prospect' | 'customer' | 'partner' | 'archived';
  source: string | null;
  companyId: string | null;
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

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contacts', search, page],
    queryFn: () =>
      api.get<Page<Contact>>(
        `/api/v1/contacts?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Contactos</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Personas</h1>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>
          Nuevo contacto
        </Button>
      </header>

      <div className="card p-3 mb-4 flex items-center gap-2">
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
        />
      </div>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}
      {isError && (
        <EmptyState
          title="No se pudo cargar la lista"
          description={(error as ApiClientError)?.message ?? 'Error desconocido'}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          title={search ? 'Sin resultados' : 'Aún no tienes contactos'}
          description={search ? 'Prueba con otro término o crea uno nuevo.' : 'Empieza creando tu primer contacto o importando un CSV.'}
          action={
            <Button variant="accent" onClick={() => setCreateOpen(true)}>
              Crear contacto
            </Button>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Email</th>
                <th>Ciclo</th>
                <th>Actividad</th>
                <th className="text-right">Creado</th>
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
                  <td className="text-ink-700">{c.email ?? '—'}</td>
                  <td>
                    <Badge tone={c.lifecycle === 'customer' ? 'ok' : c.lifecycle === 'prospect' ? 'lime' : 'neutral'}>
                      {c.lifecycle}
                    </Badge>
                  </td>
                  <td className="text-[12px] text-ink-500">{relativeFromNow(c.lastActivityAt ?? c.updatedAt)}</td>
                  <td className="text-right text-[12px] text-ink-500">{formatShortDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <span>
            Página {page} de {data.totalPages}
          </span>
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

function CreateContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [lifecycle, setLifecycle] = useState<Contact['lifecycle']>('lead');
  const [note, setNote] = useState('');
  const toast = useToast();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async () =>
      api.post<{ id: string }>('/api/v1/contacts', {
        fullName,
        email: email || undefined,
        phone: phone || undefined,
        jobTitle: jobTitle || undefined,
        lifecycle,
      }),
    onSuccess: async (res) => {
      toast.push({ tone: 'ok', title: 'Contacto creado', body: fullName });
      if (note) {
        await api.post('/api/v1/notes', { subjectType: 'contact', subjectId: res.id, body: note }).catch(() => undefined);
      }
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
      onClose();
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
      title="Nuevo contacto"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            onClick={() => create.mutate()}
            disabled={!fullName || create.isPending}
            loading={create.isPending}
          >
            Crear contacto
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
      </div>
      <div className="mt-3">
        <Field label="Nota inicial (opcional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contexto, de dónde vino, qué habló…" />
        </Field>
      </div>
    </Modal>
  );
}
