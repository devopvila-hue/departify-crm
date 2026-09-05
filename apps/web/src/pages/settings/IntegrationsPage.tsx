import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function IntegrationsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['service-keys'],
    queryFn: () => api.get<ApiKey[]>('/api/v1/service-keys'),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/service-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['service-keys'] });
      toast.push({ tone: 'ok', title: 'Clave revocada' });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Integraciones</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Claves de servicio</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">
            Estas claves permiten a sistemas externos — por ejemplo DEPARTIFY — operar el CRM en nombre de tu organización sin compartir contraseñas de usuarios.
          </p>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Nueva clave</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}
      {data && data.length === 0 && (
        <EmptyState
          title="Sin claves de servicio"
          description="Crea una para empezar a integrar DEPARTIFY u otras automatizaciones."
          action={<Button variant="accent" onClick={() => setCreateOpen(true)}>Crear clave</Button>}
        />
      )}

      {data && data.length > 0 && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Prefijo</th>
                <th>Scopes</th>
                <th>Estado</th>
                <th>Último uso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td>
                    <p className="text-sm text-ink-900">{k.name}</p>
                    <p className="text-[11px] text-ink-500">Creada {formatDate(k.createdAt)}</p>
                  </td>
                  <td className="font-mono text-[12px] text-ink-700">{k.prefix}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.length === 0 ? <span className="text-[11px] text-ink-400">todos</span>
                        : k.scopes.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}
                    </div>
                  </td>
                  <td>
                    <Badge tone={k.status === 'active' ? 'ok' : 'neutral'}>{k.status}</Badge>
                  </td>
                  <td className="text-[12px] text-ink-500">{k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => revoke.mutate(k.id)}>Revocar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateKeyModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('service:read service:write');
  const [issued, setIssued] = useState<{ secret: string; prefix: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; secret: string; prefix: string }>('/api/v1/service-keys', {
        name,
        scopes: scopes.split(/\s+/).filter(Boolean),
      }),
    onSuccess: (res) => {
      setIssued({ secret: res.secret, prefix: res.prefix });
      void qc.invalidateQueries({ queryKey: ['service-keys'] });
      toast.push({ tone: 'ok', title: 'Clave creada', body: 'Copia el secreto ahora. No se mostrará de nuevo.' });
    },
  });

  return (
    <Modal
      open={open}
      onClose={() => {
        setName(''); setScopes('service:read service:write'); setIssued(null);
        onClose();
      }}
      title={issued ? 'Clave emitida' : 'Nueva clave de servicio'}
      size={issued ? 'md' : 'sm'}
      footer={
        issued ? (
          <Button variant="accent" onClick={() => { setName(''); setIssued(null); onClose(); }}>Cerrar</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="accent" onClick={() => create.mutate()} disabled={!name || create.isPending} loading={create.isPending}>
              Crear
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700">
            Guarda el secreto ahora. Por seguridad <strong>no se mostrará de nuevo</strong>.
          </p>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 font-mono break-all">
            {issued.prefix}{issued.secret}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(`${issued.prefix}${issued.secret}`);
              toast.push({ tone: 'info', title: 'Copiado al portapapeles' });
            }}
          >
            Copiar
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="DEPARTIFY prod" autoFocus /></Field>
          <Field label="Scopes" hint="Separados por espacio. Ej: service:read service:write"><Input value={scopes} onChange={(e) => setScopes(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}
