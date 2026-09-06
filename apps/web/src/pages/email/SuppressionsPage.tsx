import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';
import type { Suppression, SuppressionReason } from './types';

const REASONS: { id: SuppressionReason; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'unsubscribed', label: 'Unsubscribe' },
  { id: 'hard_bounce', label: 'Hard bounce' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'invalid', label: 'Invalid' },
];

export function SuppressionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['email-suppressions'],
    queryFn: () => api.get<Suppression[]>('/api/v1/email/suppressions'),
  });
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="px-8 py-6 max-w-[1100px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Supresiones</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Los contactos de esta lista nunca recibirán emails. Se rellena automáticamente con unsubscribes, hard bounces y complaints. Puedes añadir casos manuales aquí.
          </p>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Añadir manualmente</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}

      {data && data.length === 0 && (
        <p className="text-sm text-ink-500 border border-dashed border-ink-200 rounded-md px-3 py-6 text-center">
          Ningún destinatario está suprimido. Bien.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Motivo</th>
                <th className="text-left px-4 py-2 font-medium">Origen</th>
                <th className="text-right px-4 py-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink-700">{s.email}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={s.reason === 'complaint' ? 'bad' : s.reason === 'hard_bounce' ? 'warn' : 'neutral'}>
                      {s.reason}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 text-[12px]">{s.source ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-ink-500 text-[12px]">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateSuppressionModal onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function CreateSuppressionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<SuppressionReason>('manual');
  const [source, setSource] = useState('manual_ui');

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/v1/email/suppressions', { email, reason, source }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-suppressions'] });
      toast.push({ tone: 'ok', title: 'Suprimido' });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error suprimiendo';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  return (
    <Modal open onClose={onClose} title="Añadir supresión">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Motivo">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as SuppressionReason)}
            className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
          >
            {REASONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Origen (nota interna)">
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={create.isPending}>
            {create.isPending ? 'Suprimiendo…' : 'Suprimir'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
