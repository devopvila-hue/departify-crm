import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { Badge } from '../../components/design-system/Badge';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';

interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  subjectType: 'contact' | 'company' | 'deal' | 'general';
  subjectId: string | null;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function TasksPage() {
  const [params] = useSearchParams();
  const overdue = params.get('overdue') === '1';
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', overdue],
    queryFn: () => api.get<Page<Task>>(`/api/v1/tasks?pageSize=100${overdue ? '&overdue=1' : ''}`),
  });
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'done' | 'cancelled' }) =>
      api.patch(`/api/v1/tasks/${id}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Tareas</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">{overdue ? 'Vencidas' : 'Todas'}</h1>
        </div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}>Nueva tarea</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}
      {data && data.items.length === 0 && (
        <EmptyState
          title="No hay tareas"
          description={overdue ? 'Nada vencido. Buen trabajo.' : 'Crea la primera para empezar a organizarte.'}
          action={<Button variant="accent" onClick={() => setCreateOpen(true)}>Crear tarea</Button>}
        />
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Vence</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <p className="text-sm text-ink-900">{t.title}</p>
                    {t.description && <p className="text-[11px] text-ink-500 line-clamp-1">{t.description}</p>}
                  </td>
                  <td className="text-[12px] text-ink-600">{t.dueAt ? formatDate(t.dueAt) : '—'}</td>
                  <td>
                    {t.priority === 'urgent' ? <Badge tone="bad">Urgente</Badge>
                      : t.priority === 'high' ? <Badge tone="warn">Alta</Badge>
                      : <Badge tone="neutral">{t.priority}</Badge>}
                  </td>
                  <td>
                    {t.status === 'done' ? <Badge tone="ok">Hecha</Badge>
                      : t.status === 'cancelled' ? <Badge tone="neutral">Cancelada</Badge>
                      : <Badge tone="lime">Abierta</Badge>}
                  </td>
                  <td className="text-right">
                    {t.status !== 'done' && (
                      <Button size="sm" variant="outline" onClick={() => update.mutate({ id: t.id, status: 'done' })}>
                        Marcar hecha
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/v1/tasks', {
        title,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['attention'] });
      toast.push({ tone: 'ok', title: 'Tarea creada' });
      onClose();
      setTitle(''); setDueAt('');
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva tarea"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => create.mutate()} disabled={!title || create.isPending} loading={create.isPending}>Crear</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vencimiento"><Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
          <Field label="Prioridad">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-sm"
            >
              <option value="low">Baja</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
