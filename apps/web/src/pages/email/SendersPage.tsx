import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';
import type { EmailProviderId, EmailSender } from './types';

const PROVIDERS: { id: EmailProviderId; label: string; help: string }[] = [
  { id: 'fake', label: 'Fake (dev)', help: 'No envía nada real. Solo para probar el flujo.' },
  { id: 'resend', label: 'Resend', help: 'API key de Resend (re_…).' },
  { id: 'brevo', label: 'Brevo', help: 'API key v3 de Brevo (xkeysib-…).' },
];

export function SendersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['email-senders'],
    queryFn: () => api.get<EmailSender[]>('/api/v1/email/senders'),
  });
  const [createOpen, setCreateOpen] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/email/senders/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-senders'] });
      toast.push({ tone: 'ok', title: 'Sender eliminado' });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error eliminando';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1100px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Senders</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Direcciones desde las que enviaremos emails. Las credenciales se cifran en reposo (AES-256-GCM) y nunca vuelven a salir.
          </p>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Nuevo sender</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}

      {data && data.length === 0 && (
        <EmptyState
          title="Aún no tienes senders"
          description="Crea el primero. Empieza por uno con provider 'fake' para probar el flujo sin enviar nada real."
          action={<Button onClick={() => setCreateOpen(true)}>Crear sender</Button>}
        />
      )}

      {data && data.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Nombre</th>
                <th className="text-left px-4 py-2 font-medium">From</th>
                <th className="text-left px-4 py-2 font-medium">Provider</th>
                <th className="text-left px-4 py-2 font-medium">Estado</th>
                <th className="text-right px-4 py-2 font-medium">Límite/día</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 text-ink-900 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-ink-700 font-mono text-[12px]">
                    {s.name} &lt;{s.email}&gt;
                    {s.replyTo && <span className="text-ink-400"> (reply-to: {s.replyTo})</span>}
                  </td>
                  <td className="px-4 py-2.5"><Badge>{s.provider}</Badge></td>
                  <td className="px-4 py-2.5">
                    <Badge tone={s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'neutral'}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-600">{s.dailyLimit}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                      onClick={() => {
                        if (confirm(`¿Eliminar el sender "${s.name}"?`)) del.mutate(s.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[11px] text-ink-500 bg-ink-50/60 border-t border-ink-100">
            {data.length} sender{data.length === 1 ? '' : 's'} · creado más reciente:{' '}
            {formatDate(data.map((d) => d.createdAt).sort().slice(-1)[0]!)}
          </div>
        </div>
      )}

      <CreateSenderModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateSenderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [provider, setProvider] = useState<EmailProviderId>('fake');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dailyLimit, setDailyLimit] = useState(500);

  const create = useMutation({
    mutationFn: () =>
      api.post<EmailSender>('/api/v1/email/senders', {
        provider,
        name,
        email,
        replyTo: replyTo || undefined,
        dailyLimit,
        credentials: { apiKey: apiKey || 'placeholder' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-senders'] });
      toast.push({ tone: 'ok', title: 'Sender creado' });
      onClose();
      setName('');
      setEmail('');
      setReplyTo('');
      setApiKey('');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error creando sender';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo sender">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as EmailProviderId)}
            className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-ink-500 mt-1">
            {PROVIDERS.find((p) => p.id === provider)?.help}
          </p>
        </Field>
        <Field label="Nombre mostrado">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Equipo DEPARTIFY" />
        </Field>
        <Field label="Email remitente">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="hola@tuempresa.com"
          />
        </Field>
        <Field label="Reply-to (opcional)">
          <Input
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="soporte@tuempresa.com"
          />
        </Field>
        {provider !== 'fake' && (
          <Field label="API key">
            <Textarea
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              placeholder={provider === 'resend' ? 're_…' : 'xkeysib-…'}
            />
            <p className="text-[11px] text-ink-500 mt-1">
              Se cifra con AES-256-GCM y no se vuelve a mostrar.
            </p>
          </Field>
        )}
        <Field label="Límite diario">
          <Input
            type="number"
            min={1}
            max={1_000_000}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={create.isPending}>
            {create.isPending ? 'Creando…' : 'Crear sender'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function _statusOptions() {
  return null;
}
void _statusOptions;
