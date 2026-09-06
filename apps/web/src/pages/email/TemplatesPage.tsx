import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Modal } from '../../components/design-system/Modal';
import { EmptyState } from '../../components/design-system/EmptyState';
import { useToast } from '../../components/design-system/Toast';
import { formatDate } from '../../lib/format';
import type { EmailTemplate } from './types';

interface _PreviewResp {
  subject: string;
  text: string;
  html?: string;
}
void (0 as unknown as _PreviewResp);

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/v1/email/templates'),
  });
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/email/templates/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.push({ tone: 'ok', title: 'Plantilla eliminada' });
    },
  });

  return (
    <div className="px-8 py-6 max-w-[1100px] mx-auto animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email</p>
          <h1 className="text-2xl font-semibold text-ink-900 mt-1">Plantillas</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Variables disponibles en subject y body: <code className="font-mono text-[12px]">{'{{first_name}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{last_name}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{full_name}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{email}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{job_title}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{organization.name}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{sender.name}}'}</code>,{' '}
            <code className="font-mono text-[12px]">{'{{today}}'}</code>.
          </p>
        </div>
        <Button variant="accent" onClick={() => setCreating(true)}>Nueva plantilla</Button>
      </header>

      {isLoading && <p className="text-sm text-ink-500">Cargando…</p>}

      {data && data.length === 0 && (
        <EmptyState
          title="Aún no tienes plantillas"
          description="Las plantillas te permiten reutilizar copy con variables por contacto."
          action={<Button onClick={() => setCreating(true)}>Crear plantilla</Button>}
        />
      )}

      {data && data.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Nombre</th>
                <th className="text-left px-4 py-2 font-medium">Asunto</th>
                <th className="text-left px-4 py-2 font-medium">HTML</th>
                <th className="text-right px-4 py-2 font-medium">Actualizada</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 text-ink-900 font-medium">{t.name}</td>
                  <td className="px-4 py-2.5 text-ink-700 max-w-md truncate">{t.subject}</td>
                  <td className="px-4 py-2.5 text-ink-500">{t.htmlBody ? 'sí' : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-ink-500 text-[12px]">{formatDate(t.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-900 text-[12px] underline mr-3"
                      onClick={() => setEditing(t)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-900 text-[12px] underline"
                      onClick={() => {
                        if (confirm(`¿Eliminar la plantilla "${t.name}"?`)) del.mutate(t.id);
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
        <TemplateEditor
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

function TemplateEditor({
  initial,
  onClose,
}: {
  initial: EmailTemplate | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [htmlBody, setHtmlBody] = useState(initial?.htmlBody ?? '');
  const [showHtml, setShowHtml] = useState(Boolean(initial?.htmlBody));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        subject,
        body,
        htmlBody: showHtml && htmlBody.trim() ? htmlBody : undefined,
      };
      if (initial) return api.patch<{ ok: true; id: string }>(`/api/v1/email/templates/${initial.id}`, payload);
      return api.post<{ id: string }>('/api/v1/email/templates', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.push({ tone: 'ok', title: initial ? 'Plantilla actualizada' : 'Plantilla creada' });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Error guardando plantilla';
      toast.push({ tone: 'bad', title: msg });
    },
  });

  return (
    <Modal open onClose={onClose} title={initial ? 'Editar plantilla' : 'Nueva plantilla'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Nombre interno">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Asunto">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>
        <Field label="Cuerpo (texto plano, soporta {`{{variables}}`})">
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <div className="flex items-center gap-2">
          <input
            id="use-html"
            type="checkbox"
            checked={showHtml}
            onChange={(e) => setShowHtml(e.target.checked)}
          />
          <label htmlFor="use-html" className="text-sm text-ink-700">
            Adjuntar cuerpo HTML personalizado
          </label>
        </div>
        {showHtml && (
          <Field label="HTML (opcional)">
            <Textarea rows={6} value={htmlBody} onChange={(e) => setHtmlBody(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
