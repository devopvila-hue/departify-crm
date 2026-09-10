import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { eur, formatDate } from '../../lib/format';
import { DEAL_STATUS_LABEL, label } from '../../lib/labels';
import { Badge } from '../../components/design-system/Badge';
import { Avatar } from '../../components/design-system/Avatar';
import { Button } from '../../components/design-system/Button';
import { Field, Input, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { useToast } from '../../components/design-system/Toast';
import { ActivityFeed, type ActivityItemData } from '../../components/crm/ActivityFeed';
import { CreateTaskModal } from '../tasks/TasksPage';

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
  companyName?: string | null;
  updatedAt: string;
  createdAt: string;
  contacts: Array<{ id: string; fullName: string; email: string | null; jobTitle: string | null }>;
}

interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  defaultProbability: number;
  isWon: number;
  isLost: number;
}

interface Page<T> {
  items: T[];
}

export function DealDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => api.get<Deal>(`/api/v1/deals/${id}`),
    enabled: !!id,
  });

  // Fetch the pipeline's stages through the kanban shape so the move
  // select is truthful (only the stages of this pipeline).
  const { data: kanban } = useQuery({
    queryKey: ['kanban', data?.pipelineId],
    queryFn: () => api.get<{ stages: Stage[] }>(`/api/v1/pipelines/${data?.pipelineId}/kanban`),
    enabled: !!data?.pipelineId,
  });
  const pipelineStages = kanban?.stages ?? [];

  const { data: activities } = useQuery({
    queryKey: ['deal-activities', id],
    queryFn: () =>
      api.get<Page<ActivityItemData>>(
        `/api/v1/activities?pageSize=50&subjectType=deal&subjectId=${encodeURIComponent(id)}`,
      ),
    enabled: !!id,
  });

  const move = useMutation({
    mutationFn: (stageId: string) => api.post(`/api/v1/deals/${id}/move`, { stageId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deal', id] });
      void qc.invalidateQueries({ queryKey: ['kanban'] });
      void qc.invalidateQueries({ queryKey: ['deal-activities', id] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
      toast.push({ tone: 'ok', title: 'Etapa actualizada' });
    },
  });

  if (isLoading) return <p className="px-8 py-6 text-sm text-ink-500">Cargando…</p>;
  if (isError || !data)
    return <p className="px-8 py-6 text-sm text-signal-bad">No se pudo cargar el deal.</p>;
  const d = data;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <Link to="/pipeline" className="text-[12px] text-ink-500 hover:text-ink-800">
        ← Pipeline
      </Link>
      <header className="mt-2 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink-900 truncate">{d.name}</h1>
          <p className="money text-2xl font-semibold text-ink-800 mt-1">
            {eur.format(d.valueMinor / 100)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={d.status === 'won' ? 'ok' : d.status === 'lost' ? 'bad' : 'neutral'}>
              {label(DEAL_STATUS_LABEL, d.status)}
            </Badge>
            {d.probability > 0 && <Badge tone="neutral">{d.probability}% probabilidad</Badge>}
            {d.expectedCloseAt && (
              <Badge tone="neutral">Cierre {formatDate(d.expectedCloseAt)}</Badge>
            )}
            {d.companyId && d.companyName && (
              <Link to={`/companies/${d.companyId}`}>
                <Badge tone="blue">{d.companyName}</Badge>
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Editar
          </Button>
          <Button onClick={() => setNoteOpen(true)}>Añadir nota</Button>
          <Button variant="accent" onClick={() => setTaskOpen(true)}>
            Crear tarea
          </Button>
        </div>
      </header>

      {pipelineStages.length > 1 && (
        <div className="mt-4 card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <label htmlFor="deal-stage" className="text-[12px] text-ink-500 shrink-0">
            Etapa
          </label>
          <select
            id="deal-stage"
            value={d.stageId}
            disabled={move.isPending}
            onChange={(e) => move.mutate(e.target.value)}
            className="h-9 rounded-md border border-ink-200 bg-white px-3 text-sm flex-1 min-w-0"
          >
            {pipelineStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{' '}
                {s.isWon
                  ? '· cuando gana'
                  : s.isLost
                    ? '· cuando pierde'
                    : `· ${s.defaultProbability}%`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900 mb-3">Actividad</h2>
            <ActivityFeed
              items={activities?.items ?? []}
              loading={!activities}
              emptyTitle="Sin actividad todavía"
              emptyDescription="Cuando cambie de etapa, se registre una nota o se cree una tarea, aparecerá aquí."
              showSubject={false}
            />
          </div>
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900 mb-3">Contactos vinculados</h2>
            {d.contacts.length === 0 ? (
              <p className="text-sm text-ink-500">
                Aún no hay contactos. Añádelos al editar el deal.
              </p>
            ) : (
              <ul className="space-y-2">
                {d.contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <Avatar name={c.fullName} />
                    <div>
                      <Link
                        to={`/contacts/${c.id}`}
                        className="text-sm text-ink-900 hover:underline"
                      >
                        {c.fullName}
                      </Link>
                      <p className="text-[11px] text-ink-500">{c.jobTitle ?? c.email ?? ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
        <aside className="card p-5 h-fit">
          <h2 className="text-sm font-semibold text-ink-900 mb-3">Datos</h2>
          <dl className="text-sm space-y-2">
            <Row
              label="Empresa"
              value={d.companyName ?? '—'}
              href={d.companyId ? `/companies/${d.companyId}` : undefined}
            />
            <Row label="Origen" value={d.source ?? '—'} />
            <Row label="Creado" value={formatDate(d.createdAt)} />
            <Row label="Actualizado" value={formatDate(d.updatedAt)} />
          </dl>
        </aside>
      </div>

      <EditDealModal open={editOpen} onClose={() => setEditOpen(false)} deal={d} />
      <NoteModal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        subjectId={d.id}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ['deal-activities', d.id] });
          toast.push({ tone: 'ok', title: 'Nota añadida' });
        }}
      />
      <CreateTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        initialSubjectType="deal"
        initialSubjectId={d.id}
        subjectLabel={d.name}
        extraInvalidateKeys={[['deal-activities', d.id]]}
      />
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</dt>
      <dd className="text-ink-800 text-right truncate min-w-0">
        {href ? (
          <Link to={href} className="hover:underline truncate inline-block max-w-full">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function NoteModal({
  open,
  onClose,
  subjectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  subjectId: string;
  onCreated: () => void;
}) {
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/api/v1/notes', { subjectType: 'deal', subjectId, body }),
    onSuccess: () => {
      setBody('');
      onClose();
      onCreated();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva nota"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            onClick={() => create.mutate()}
            disabled={!body || create.isPending}
            loading={create.isPending}
          >
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Contenido">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Qué ha pasado, qué acordamos, próximo paso…"
          autoFocus
        />
      </Field>
    </Modal>
  );
}

function EditDealModal({
  open,
  onClose,
  deal,
}: {
  open: boolean;
  onClose: () => void;
  deal: Deal;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(deal.name);
  const [value, setValue] = useState(String(deal.valueMinor / 100));
  const [probability, setProbability] = useState(String(deal.probability));
  const [closeDate, setCloseDate] = useState(
    deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '',
  );

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/deals/${deal.id}`, {
        name,
        value: Number(value) || 0,
        probability: Number(probability) || 0,
        expectedCloseAt: closeDate ? new Date(closeDate).toISOString() : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deal', deal.id] });
      void qc.invalidateQueries({ queryKey: ['kanban'] });
      toast.push({ tone: 'ok', title: 'Deal actualizado' });
      onClose();
    },
    onError: (err: Error) =>
      toast.push({ tone: 'bad', title: 'No se pudo guardar', body: err.message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar deal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            onClick={() => update.mutate()}
            disabled={!name || update.isPending}
            loading={update.isPending}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Valor (${deal.currency})`}>
            <Input
              type="number"
              min={0}
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Probabilidad (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Cierre esperado">
          <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
