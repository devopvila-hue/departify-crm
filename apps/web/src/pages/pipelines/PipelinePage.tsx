import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { eur, relativeFromNow } from '../../lib/format';
import clsx from 'clsx';

interface Pipeline { id: string; name: string; }
interface Stage { id: string; pipelineId: string; name: string; position: number; defaultProbability: number; color: string | null; isWon: number; isLost: number; }
interface Deal {
  id: string;
  pipelineId: string;
  stageId: string;
  name: string;
  valueMinor: number;
  currency: string;
  probability: number;
  expectedCloseAt: string | null;
  status: 'open' | 'won' | 'lost';
  companyId?: string | null;
  companyName?: string | null;
  updatedAt: string;
}
interface Kanban { pipeline: Pipeline; stages: Stage[]; deals: Deal[]; }

export function PipelinePage() {
  const qc = useQueryClient();
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api.get<Pipeline[]>('/api/v1/pipelines'),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: kanban, isLoading } = useQuery({
    queryKey: ['kanban', activeId],
    queryFn: () => api.get<Kanban>(`/api/v1/pipelines/${activeId}/kanban`),
    enabled: !!activeId,
  });
  const [createOpen, setCreateOpen] = useState(false);

  const moveDeal = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      api.post(`/api/v1/deals/${dealId}/move`, { stageId }),
    onSuccess: () => {
      // Optimistic: refetch the kanban instead of a full page reload.
      void qc.invalidateQueries({ queryKey: ['kanban'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  useEffect(() => {
    if (!activeId && pipelines && pipelines.length > 0) {
      setActiveId(pipelines[0]!.id);
    }
  }, [activeId, pipelines]);

  return (
    <div className="px-6 py-5 max-w-[1480px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Pipeline</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Oportunidades</h1>
        </div>
        <div className="flex items-center gap-2">
          {pipelines && pipelines.length > 0 && (
            <select
              value={activeId ?? ''}
              onChange={(e) => setActiveId(e.target.value)}
              className="h-9 rounded-md border border-ink-200 bg-white px-2 text-sm"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <Button variant="accent" onClick={() => setCreateOpen(true)}>Nuevo deal</Button>
        </div>
      </header>

      {!isLoading && pipelines && pipelines.length === 0 && (
        <EmptyState
          title="Aún no tienes un pipeline"
          description="Crea uno para empezar a gestionar tus oportunidades."
          action={<Button variant="accent" onClick={() => setCreateOpen(true)}>Crear pipeline</Button>}
        />
      )}

      {kanban && (
        <div className="overflow-x-auto -mx-2 pb-3">
          <div className="flex gap-3 px-2 min-w-max">
            {kanban.stages.map((stage) => {
              const stageDeals = kanban.deals.filter((d) => d.stageId === stage.id);
              const value = stageDeals.reduce((acc, d) => acc + d.valueMinor, 0);
              return (
                <div
                  key={stage.id}
                  className="w-72 flex-shrink-0 bg-ink-50 rounded-md border border-ink-200 flex flex-col max-h-[78vh]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    const dealId = e.dataTransfer.getData('text/deal-id');
                    if (dealId) {
                      await moveDeal.mutateAsync({ dealId, stageId: stage.id });
                    }
                  }}
                >
                  <header className="px-3 py-2 flex items-center justify-between border-b border-ink-200">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: stage.color ?? '#9CA3AF' }}
                        aria-hidden
                      />
                      <p className="text-[12px] uppercase tracking-wide text-ink-700 font-semibold">{stage.name}</p>
                    </div>
                    <Badge tone="neutral">{stageDeals.length}</Badge>
                  </header>
                  <div className="px-3 py-2 text-[11px] text-ink-500 border-b border-ink-200 flex items-center justify-between">
                    <span>Σ {eur.format(value / 100)}</span>
                    {stage.defaultProbability > 0 && <span>Prob {stage.defaultProbability}%</span>}
                  </div>
                  <div className="p-2 space-y-2 overflow-y-auto flex-1">
                    {stageDeals.length === 0 ? (
                      <p className="text-[12px] text-ink-400 px-1 py-3 text-center">Vacío</p>
                    ) : (
                      stageDeals.map((d) => (
                        <DealCard key={d.id} deal={d} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateDealModal open={createOpen} onClose={() => setCreateOpen(false)} pipelineId={activeId} />
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  return (
    <Link
      to={`/deals/${deal.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="block bg-white rounded-md border border-ink-200 p-2.5 hover:shadow-card cursor-grab active:cursor-grabbing"
    >
      <p className="text-[13px] font-medium text-ink-900 truncate">{deal.name}</p>
      {deal.companyName && <p className="text-[11px] text-ink-500 truncate">{deal.companyName}</p>}
      <p className="money text-[12px] text-ink-700 mt-0.5">{eur.format(deal.valueMinor / 100)}</p>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-500">
        <span>{relativeFromNow(deal.updatedAt)}</span>
        {deal.probability > 0 && <Badge tone="neutral">{deal.probability}%</Badge>}
      </div>
    </Link>
  );
}

export interface CreateDealModalProps {
  open: boolean;
  onClose: () => void;
  /** Omit to let the modal resolve (or provision) the workspace's default pipeline. */
  pipelineId?: string | null;
  /** Pre-links the deal to a company, e.g. when opened from a Company record. */
  companyId?: string;
  /** People offered as contacts on the deal — the company's, when opened from one. */
  people?: Array<{ id: string; fullName: string }>;
  /** Rendered above the form, e.g. "Acme S.L.". */
  subjectLabel?: string;
  /** Extra query keys to invalidate on success (e.g. ['company-deals', id]). */
  extraInvalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

export function CreateDealModal({
  open,
  onClose,
  pipelineId,
  companyId,
  people,
  subjectLabel,
  extraInvalidateKeys,
}: CreateDealModalProps) {
  const qc = useQueryClient();
  const toast = useToast();

  // A workspace that has never opened the Pipeline page has no pipeline
  // yet. Provision the default one on demand so "Nuevo deal" is never a
  // dead end. The endpoint is idempotent.
  const ensured = useQuery({
    queryKey: ['default-pipeline'],
    queryFn: () => api.post<{ id: string }>('/api/v1/pipelines/ensure-default'),
    enabled: open && !pipelineId,
    staleTime: Infinity,
  });
  const activePipelineId = pipelineId ?? ensured.data?.id ?? null;

  const { data: kanban } = useQuery({
    queryKey: ['kanban', activePipelineId],
    queryFn: () => api.get<Kanban>(`/api/v1/pipelines/${activePipelineId}/kanban`),
    enabled: !!activePipelineId,
  });
  const [name, setName] = useState('');
  const [value, setValue] = useState('0');
  const [stageId, setStageId] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [contactIds, setContactIds] = useState<string[]>([]);

  useEffect(() => {
    if (kanban && !stageId) {
      const firstOpen = kanban.stages.find((s) => !s.isWon && !s.isLost);
      if (firstOpen) setStageId(firstOpen.id);
    }
  }, [kanban, stageId]);

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/v1/deals', {
        pipelineId: activePipelineId,
        stageId,
        name,
        value: Number(value) || 0,
        expectedCloseAt: closeDate ? new Date(closeDate).toISOString() : undefined,
        ...(companyId ? { companyId } : {}),
        ...(contactIds.length ? { contactIds } : {}),
      }),
    onSuccess: () => {
      toast.push({ tone: 'ok', title: 'Deal creado' });
      void qc.invalidateQueries({ queryKey: ['kanban'] });
      void qc.invalidateQueries({ queryKey: ['deals'] });
      for (const key of extraInvalidateKeys ?? []) {
        void qc.invalidateQueries({ queryKey: key });
      }
      onClose();
      setName(''); setValue('0'); setCloseDate(''); setContactIds([]);
    },
    onError: (err: Error) => {
      toast.push({ tone: 'bad', title: 'No se pudo crear el deal', body: err.message });
    },
  });

  const stages = useMemo(() => kanban?.stages ?? [], [kanban]);
  const valid = !!activePipelineId && !!stageId && !!name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subjectLabel ? `Nuevo deal · ${subjectLabel}` : 'Nuevo deal'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => create.mutate()} disabled={!valid || create.isPending} loading={create.isPending}>
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre del deal"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (EUR)">
            <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Cierre esperado">
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Etapa inicial">
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className={clsx('h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm')}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        {people && people.length > 0 && (
          <Field label="Personas">
            <div className="max-h-32 overflow-y-auto rounded-md border border-ink-200 divide-y divide-ink-100">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={contactIds.includes(p.id)}
                    onChange={(e) =>
                      setContactIds((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span className="truncate">{p.fullName}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
