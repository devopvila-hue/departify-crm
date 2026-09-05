import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { Badge } from '../../components/design-system/Badge';
import { Avatar } from '../../components/design-system/Avatar';
import { useToast } from '../../components/design-system/Toast';
import { formatDate, relativeFromNow } from '../../lib/format';

interface Contact {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycle: string;
  source: string | null;
  companyId: string | null;
  ownerId: string | null;
  customValues: Record<string, unknown>;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Activity {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  body: string;
  createdAt: string;
}

interface Timeline {
  activities: Activity[];
  notes: Note[];
}

export function ContactDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const { data: contact, isLoading, isError, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get<Contact>(`/api/v1/contacts/${id}`),
    enabled: !!id,
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', id],
    queryFn: () => api.get<Timeline>(`/api/v1/contacts/${id}/timeline`),
    enabled: !!id,
  });

  if (isLoading) return <p className="px-8 py-6 text-sm text-ink-500">Cargando…</p>;
  if (isError || !contact) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-signal-bad">No se pudo cargar el contacto: {(error as ApiClientError)?.message}</p>
        <Link to="/contacts" className="text-sm text-ink-700 hover:underline mt-2 inline-block">← Volver</Link>
      </div>
    );
  }

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <Link to="/contacts" className="text-[12px] text-ink-500 hover:text-ink-800">← Contactos</Link>

      <header className="mt-2 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={contact.fullName} size={56} />
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">{contact.fullName}</h1>
            <p className="text-sm text-ink-500">
              {contact.jobTitle ?? '—'}
              {contact.email ? ` · ${contact.email}` : ''}
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge tone={contact.lifecycle === 'customer' ? 'ok' : 'neutral'}>{contact.lifecycle}</Badge>
              {contact.source && <Badge tone="neutral">{contact.source}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>Editar</Button>
          <Button onClick={() => setNoteOpen(true)}>Añadir nota</Button>
          <Button variant="accent" onClick={() => setTaskOpen(true)}>Crear tarea</Button>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900 mb-3">Timeline</h2>
            {!timeline || (timeline.activities.length === 0 && timeline.notes.length === 0) ? (
              <p className="text-sm text-ink-500">Aún no hay actividad. Crea una nota para empezar.</p>
            ) : (
              <ul className="space-y-3">
                {[...timeline.activities, ...timeline.notes.map((n) => ({ ...n, type: 'note', title: 'Nota' }))]
                  .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                  .map((a) => (
                    <li key={a.id} className="flex gap-3">
                      <div className="size-1.5 rounded-full bg-ink-300 mt-2" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-900">
                          <span className="font-medium">{a.title}</span>
                          {a.body ? <span className="text-ink-700"> — {a.body}</span> : null}
                        </p>
                        <p className="text-[11px] text-ink-500">
                          {a.type} · {relativeFromNow(a.createdAt)} · {formatDate(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900 mb-3">Datos</h2>
            <dl className="text-sm space-y-2">
              <Row label="Email" value={contact.email ?? '—'} />
              <Row label="Teléfono" value={contact.phone ?? '—'} />
              <Row label="Cargo" value={contact.jobTitle ?? '—'} />
              <Row label="Ciclo" value={contact.lifecycle} />
              <Row label="Origen" value={contact.source ?? '—'} />
              <Row label="Creado" value={formatDate(contact.createdAt)} />
            </dl>
          </div>
          {Object.keys(contact.customValues ?? {}).length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink-900 mb-3">Campos personalizados</h2>
              <dl className="text-sm space-y-2">
                {Object.entries(contact.customValues).map(([k, v]) => (
                  <Row key={k} label={k} value={String(v)} />
                ))}
              </dl>
            </div>
          )}
        </aside>
      </div>

      <NoteModal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        subjectId={contact.id}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ['contact-timeline', id] });
          toast.push({ tone: 'ok', title: 'Nota añadida' });
        }}
      />
      <TaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        subjectId={contact.id}
        subjectType="contact"
        onCreated={() => {
          toast.push({ tone: 'ok', title: 'Tarea creada' });
        }}
      />
      <EditContactModal
        open={editing}
        onClose={() => setEditing(false)}
        contact={contact}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['contact', id] });
          toast.push({ tone: 'ok', title: 'Contacto actualizado' });
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">{label}</dt>
      <dd className="text-ink-800 text-right truncate">{value}</dd>
    </div>
  );
}

function NoteModal({ open, onClose, subjectId, onCreated }: { open: boolean; onClose: () => void; subjectId: string; onCreated: () => void }) {
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/api/v1/notes', { subjectType: 'contact', subjectId, body }),
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
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => create.mutate()} disabled={!body || create.isPending} loading={create.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Contenido">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Llamó para pedir información, le interesa X…" autoFocus />
      </Field>
    </Modal>
  );
}

function TaskModal({ open, onClose, subjectId, subjectType, onCreated }: { open: boolean; onClose: () => void; subjectId: string; subjectType: 'contact' | 'company' | 'deal' | 'general'; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/v1/tasks', {
        title,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority,
        subjectType,
        subjectId,
      }),
    onSuccess: () => {
      setTitle('');
      setDueAt('');
      onClose();
      onCreated();
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
          <Button variant="accent" onClick={() => create.mutate()} disabled={!title || create.isPending} loading={create.isPending}>
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Llamar para confirmar la demo" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vencimiento">
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
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

function EditContactModal({ open, onClose, contact, onSaved }: { open: boolean; onClose: () => void; contact: Contact; onSaved: () => void }) {
  const [fullName, setFullName] = useState(contact.fullName);
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? '');
  const update = useMutation({
    mutationFn: () => api.patch(`/api/v1/contacts/${contact.id}`, { fullName, email, phone, jobTitle }),
    onSuccess: () => {
      onClose();
      onSaved();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar contacto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={() => update.mutate()} disabled={update.isPending} loading={update.isPending}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre completo"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Teléfono"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Cargo"><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
