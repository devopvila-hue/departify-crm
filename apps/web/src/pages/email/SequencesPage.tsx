import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';
import type { EmailSender, EmailTemplate, Sequence, SequenceStep } from './types';

function newStep(kind: SequenceStep['kind']): SequenceStep {
  switch (kind) {
    case 'email':
      return { kind: 'email' };
    case 'wait':
      return { kind: 'wait', waitDays: 1 };
    case 'conditional':
      return { kind: 'conditional', ifEvent: 'opened', thenAction: 'continue' };
    case 'exit':
      return { kind: 'exit' };
  }
}

export function SequencesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['email-sequences'],
    queryFn: () => api.get<Sequence[]>('/api/v1/email/sequences'),
  });
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/email/sequences/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-sequences'] });
      toast.push({ tone: 'ok', title: 'Secuencia eliminada' });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1200px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Secuencias</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Una secuencia es una serie ordenada de pasos (email, espera, condición, salida) que se ejecuta por contacto.
            El worker avanza cada enrollment de forma atómica: si reinicia, ningún contacto recibe dos veces el mismo paso.
          </p>
        </div>
        <Button variant="accent" onClick={() => setCreating(true)}>Nueva secuencia</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}

      {data && data.length === 0 && (
        <EmptyState
          title="Aún no tienes secuencias"
          description="Crea la primera. Empieza con un email de bienvenida, espera 2 días, y un segundo email si no abrió el primero."
          action={<Button onClick={() => setCreating(true)}>Crear secuencia</Button>}
        />
      )}

      {data && data.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Nombre</th>
                <th className="text-left px-4 py-2 font-medium">Pasos</th>
                <th className="text-left px-4 py-2 font-medium">Estado</th>
                <th className="text-left px-4 py-2 font-medium">Ventana</th>
                <th className="text-right px-4 py-2 font-medium">Actualizada</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 text-ink-900 font-medium">
                    <Link to={`/email/sequences/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">
                    {s.steps.length} paso{s.steps.length === 1 ? '' : 's'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'neutral'}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 text-[12px]">
                    {s.sendingWindowStart}–{s.sendingWindowEnd} · {s.timezone}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-500 text-[12px]">{formatDate(s.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-900 text-[12px] underline mr-3"
                      onClick={() => setEditing(s)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                      onClick={() => {
                        if (confirm(`¿Eliminar la secuencia "${s.name}"?`)) del.mutate(s.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <SequenceEditor
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SequenceEditor({ initial, onClose }: { initial: Sequence | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'Europe/Madrid');
  const [start, setStart] = useState(initial?.sendingWindowStart ?? '09:00');
  const [end, setEnd] = useState(initial?.sendingWindowEnd ?? '18:00');
  const [status, setStatus] = useState<Sequence['status']>(initial?.status ?? 'draft');
  const [steps, setSteps] = useState<SequenceStep[]>(initial?.steps ?? [newStep('email'), newStep('wait')]);

  const { data: senders } = useQuery({
    queryKey: ['email-senders'],
    queryFn: () => api.get<EmailSender[]>('/api/v1/email/senders'),
  });
  const { data: templates } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/v1/email/templates'),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        timezone,
        sendingWindowStart: start,
        sendingWindowEnd: end,
        status,
        steps,
      };
      if (initial) return api.patch<{ ok: true; id: string }>(`/api/v1/email/sequences/${initial.id}`, payload);
      return api.post<{ id: string }>('/api/v1/email/sequences', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-sequences'] });
      toast.push({ tone: 'ok', title: initial ? 'Secuencia actualizada' : 'Secuencia creada' });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error guardando secuencia';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...steps];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setSteps(next);
  };

  const remove = (idx: number) => setSteps(steps.filter((_, i) => i !== idx));
  const add = (kind: SequenceStep['kind']) => setSteps([...steps, newStep(kind)]);

  return (
    <Modal open onClose={onClose} title={initial ? 'Editar secuencia' : 'Nueva secuencia'} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Estado">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Sequence['status'])}
              className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
            >
              <option value="draft">Borrador</option>
              <option value="active">Activa</option>
              <option value="paused">Pausada</option>
              <option value="archived">Archivada</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Zona horaria">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
          <Field label="Ventana inicio">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ventana fin">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="flex items-end justify-between mb-2">
            <p className="text-sm font-medium text-ink-800">Pasos ({steps.length})</p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" onClick={() => add('email')}>+ Email</Button>
              <Button type="button" variant="ghost" onClick={() => add('wait')}>+ Espera</Button>
              <Button type="button" variant="ghost" onClick={() => add('conditional')}>+ Condición</Button>
              <Button type="button" variant="ghost" onClick={() => add('exit')}>+ Salida</Button>
            </div>
          </div>
          <ol className="space-y-2">
            {steps.map((s, idx) => (
              <StepRow
                key={idx}
                step={s}
                index={idx}
                total={steps.length}
                senders={senders ?? []}
                templates={templates ?? []}
                onChange={(next) => setSteps(steps.map((cur, i) => (i === idx ? next : cur)))}
                onMoveUp={() => move(idx, -1)}
                onMoveDown={() => move(idx, 1)}
                onRemove={() => remove(idx)}
              />
            ))}
          </ol>
          {steps.length === 0 && (
            <p className="text-sm text-ink-500 border border-dashed border-ink-200 rounded-md px-3 py-6 text-center">
              Añade al menos un paso (por ejemplo, un email de bienvenida).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={save.isPending || steps.length === 0}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StepRow({
  step,
  index,
  total,
  senders,
  templates,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: SequenceStep;
  index: number;
  total: number;
  senders: EmailSender[];
  templates: EmailTemplate[];
  onChange: (next: SequenceStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const activeSenders = senders.filter((s) => s.provider === 'fake' || s.status === 'active');
  return (
    <li className="rounded-md border border-ink-200 bg-paper p-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center text-ink-400 pt-0.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            className="text-[10px] leading-none hover:text-ink-700 disabled:opacity-30"
            aria-label="Mover arriba"
          >
            ▲
          </button>
          <span className="text-[11px] text-ink-500 my-0.5">{index + 1}</span>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={onMoveDown}
            className="text-[10px] leading-none hover:text-ink-700 disabled:opacity-30"
            aria-label="Mover abajo"
          >
            ▼
          </button>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={
                'text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ' +
                (step.kind === 'email'
                  ? 'bg-lime-50 text-lime-800'
                  : step.kind === 'wait'
                    ? 'bg-ink-100 text-ink-700'
                    : step.kind === 'conditional'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-red-50 text-red-800')
              }
            >
              {step.kind}
            </span>
          </div>
          {step.kind === 'email' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Plantilla">
                <select
                  value={step.templateId ?? ''}
                  onChange={(e) => onChange({ ...step, templateId: e.target.value || undefined })}
                  className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
                >
                  <option value="">— elige —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sender">
                <select
                  value={step.senderId ?? ''}
                  onChange={(e) => onChange({ ...step, senderId: e.target.value || undefined })}
                  className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
                >
                  <option value="">— elige —</option>
                  {activeSenders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} &lt;{s.email}&gt; ({s.provider})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {step.kind === 'wait' && (
            <Field label="Días a esperar">
              <Input
                type="number"
                min={0}
                max={365}
                value={step.waitDays ?? 0}
                onChange={(e) => onChange({ ...step, waitDays: Number(e.target.value) })}
              />
            </Field>
          )}
          {step.kind === 'conditional' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Si el último evento fue">
                <select
                  value={step.ifEvent ?? 'opened'}
                  onChange={(e) => onChange({ ...step, ifEvent: e.target.value as 'opened' | 'clicked' | 'replied' | 'bounced' })}
                  className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
                >
                  <option value="opened">abierto</option>
                  <option value="clicked">click</option>
                  <option value="replied">respondido</option>
                  <option value="bounced">bounce</option>
                </select>
              </Field>
              <Field label="Entonces">
                <select
                  value={step.thenAction ?? 'continue'}
                  onChange={(e) => onChange({ ...step, thenAction: e.target.value as 'continue' | 'exit' })}
                  className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
                >
                  <option value="continue">continuar al siguiente paso</option>
                  <option value="exit">salir de la secuencia</option>
                </select>
              </Field>
            </div>
          )}
          {step.kind === 'exit' && (
            <p className="text-[12px] text-ink-500">El contacto saldrá de la secuencia al llegar aquí.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-ink-400 hover:text-ink-900 text-[12px] underline"
        >
          Quitar
        </button>
      </div>
    </li>
  );
}

// Keep Textarea referenced so it isn't tree-shaken if a future edit
// needs it (e.g. a per-step subject override).
void Textarea;
