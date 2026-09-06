import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Badge } from '../../components/design-system/Badge';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Field, Input } from '../../components/design-system/Input';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';
import type { Sequence, SequenceEnrollment, EnrollmentStatus } from './types';

export function EnrollmentsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [showEnroll, setShowEnroll] = useState(false);

  const sequence = useQuery({
    queryKey: ['email-sequence', id],
    queryFn: () => api.get<Sequence>(`/api/v1/email/sequences/${id}`),
    enabled: Boolean(id),
  });

  const enrollments = useQuery({
    queryKey: ['email-enrollments', id],
    queryFn: () => api.get<SequenceEnrollment[]>(`/api/v1/email/sequences/${id}/enrollments`),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  const control = useMutation({
    mutationFn: ({ enrollmentId, action, reason }: { enrollmentId: string; action: 'pause' | 'resume' | 'exit'; reason?: string }) => {
      const body = reason ? JSON.stringify({ reason }) : undefined;
      return api.post(`/api/v1/email/enrollments/${enrollmentId}/${action}`, body ? JSON.parse(body) : undefined);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['email-enrollments', id] });
      const labels = { pause: 'En pausa', resume: 'Reanudado', exit: 'Salido' } as const;
      toast.push({ tone: 'ok', title: labels[vars.action] });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1200px] mx-auto animate-fade-in">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email · Secuencia</p>
        <h1 className="text-2xl font-semibold text-ink-900 mt-1">
          {sequence.data?.name ?? 'Enrollments'}
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          {sequence.data && (
            <>
              {sequence.data.steps.length} paso{sequence.data.steps.length === 1 ? '' : 's'} · estado{' '}
              <Badge tone={sequence.data.status === 'active' ? 'ok' : sequence.data.status === 'paused' ? 'warn' : 'neutral'}>
                {sequence.data.status}
              </Badge>
            </>
          )}
        </p>
      </header>

      <div className="flex items-center justify-end gap-2 mb-3">
        <Button variant="accent" onClick={() => setShowEnroll(true)}>Inscribir contacto</Button>
      </div>

      {enrollments.isLoading && <p className="text-sm text-ink-500">Cargando…</p>}

      {enrollments.data && enrollments.data.length === 0 && (
        <EmptyState
          title="Sin inscripciones"
          description="Inscribe el primer contacto para empezar a ejecutar la secuencia."
        />
      )}

      {enrollments.data && enrollments.data.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Contacto</th>
                <th className="text-left px-4 py-2 font-medium">Paso</th>
                <th className="text-left px-4 py-2 font-medium">Estado</th>
                <th className="text-left px-4 py-2 font-medium">Próxima acción</th>
                <th className="text-left px-4 py-2 font-medium">Salida</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.data.map((e) => (
                <tr key={e.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink-700">{e.contactId}</td>
                  <td className="px-4 py-2.5 text-ink-700">{e.currentStep}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 text-[12px]">
                    {e.nextActionAt ? formatDate(e.nextActionAt) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 text-[12px]">{e.exitReason ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right space-x-2">
                    {e.status === 'active' && (
                      <button
                        type="button"
                        className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                        onClick={() => control.mutate({ enrollmentId: e.id, action: 'pause' })}
                      >
                        Pausar
                      </button>
                    )}
                    {e.status === 'paused' && (
                      <button
                        type="button"
                        className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                        onClick={() => control.mutate({ enrollmentId: e.id, action: 'resume' })}
                      >
                        Reanudar
                      </button>
                    )}
                    {(e.status === 'active' || e.status === 'paused') && (
                      <button
                        type="button"
                        className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                        onClick={() => {
                          const reason = prompt('Razón de salida:');
                          if (reason) control.mutate({ enrollmentId: e.id, action: 'exit', reason });
                        }}
                      >
                        Salir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showEnroll && id && (
        <EnrollContactModal
          sequenceId={id}
          onClose={() => setShowEnroll(false)}
        />
      )}
    </div>
  );
}

function EnrollContactModal({ sequenceId, onClose }: { sequenceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [contactId, setContactId] = useState('');

  const enroll = useMutation({
    mutationFn: () =>
      api.post<{ id: string; alreadyEnrolled?: boolean; reEnrolled?: boolean }>(
        `/api/v1/email/sequences/${sequenceId}/enrollments`,
        { contactId },
      ),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['email-enrollments', sequenceId] });
      const title = d.alreadyEnrolled
        ? 'Ya estaba inscrito'
        : d.reEnrolled
          ? 'Re-inscrito'
          : 'Inscrito';
      toast.push({ tone: 'ok', title });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error inscribiendo';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  return (
    <Modal open onClose={onClose} title="Inscribir contacto">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enroll.mutate();
        }}
        className="space-y-3"
      >
        <Field label="ID de contacto">
          <Input
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
            placeholder="con_…"
          />
          <p className="text-[11px] text-ink-500 mt-1">
            Pega aquí el id de un contacto que tenga email. El worker suprimirá automáticamente los bounces, complaints y unsubscribes.
          </p>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={enroll.isPending}>
            {enroll.isPending ? 'Inscribiendo…' : 'Inscribir'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function statusTone(s: EnrollmentStatus): 'ok' | 'warn' | 'neutral' {
  if (s === 'active') return 'ok';
  if (s === 'paused') return 'warn';
  return 'neutral';
}
