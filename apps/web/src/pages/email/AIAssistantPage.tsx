import { useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { Input, Field, Textarea } from '../../components/design-system/Input';
import { Badge } from '../../components/design-system/Badge';
import type { Sequence } from './types';
interface Contact { id: string; fullName: string; email: string | null }

type ToolKey =
  | 'enrich' | 'extract' | 'score' | 'summarize' | 'risks' | 'draft' | 'list';

interface Tool {
  key: ToolKey;
  title: string;
  blurb: string;
  emoji: string;
}

const TOOLS: Tool[] = [
  { key: 'enrich',     title: 'Enriquecer contacto',   blurb: 'Pega un nombre + email y la IA deduce cargo, sector, seniority y tags.', emoji: '🪄' },
  { key: 'extract',    title: 'Pegar firma / tarjeta',  blurb: 'Pega cualquier texto y la IA extrae los campos del contacto.',         emoji: '✂️' },
  { key: 'score',      title: 'Lead score',             blurb: '¿Cuán caliente está este lead? Score 0-100 con una razón corta.',    emoji: '🎯' },
  { key: 'summarize',  title: 'Resumen del contacto',   blurb: 'TL;DR de 3 frases: quién es, último contacto, estado actual.',     emoji: '📝' },
  { key: 'risks',      title: 'Radar de riesgos',       blurb: 'Escanea tu pipeline y marca los deals que van a caer.',           emoji: '🚨' },
  { key: 'draft',      title: 'Redactar respuesta',    blurb: 'Borrador de email en el tono y la longitud adecuados.',             emoji: '✉️' },
  { key: 'list',       title: 'Lista inteligente',      blurb: 'Traduce una pregunta a un filtro de contactos.',                   emoji: '🎯' },
];

export function AIAssistantPage() {
  const [activeTool, setActiveTool] = useState<ToolKey>('risks');
  const [contactId, setContactId] = useState('');
  const [rawText, setRawText] = useState('');
  const [draftContext, setDraftContext] = useState('');
  const [listQuery, setListQuery] = useState('EU leads who opened >2 emails in the last 7 days');
  const [enrichName, setEnrichName] = useState('');
  const [enrichEmail, setEnrichEmail] = useState('');
  const [enrichCompany, setEnrichCompany] = useState('');

  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<{ configured: boolean; model: string | null; provider: string }>('/api/v1/ai/status'),
  });
  const contacts = useQuery({
    queryKey: ['contacts-min'],
    queryFn: () => api.get<{ items: Contact[] }>('/api/v1/contacts?pageSize=20'),
  });
  const sequences = useQuery({
    queryKey: ['sequences-min'],
    queryFn: () => api.get<Sequence[]>('/api/v1/email/sequences'),
  });

  const enrich = useMutation({
    mutationFn: () => api.post('/api/v1/ai/enrich-contact', { name: enrichName, email: enrichEmail || undefined, company: enrichCompany || undefined }),
  });
  const extract = useMutation({
    mutationFn: () => api.post('/api/v1/ai/extract-contact', { text: rawText }),
  });
  const score = useMutation({
    mutationFn: () => api.post('/api/v1/ai/score-contact', { contactId }),
  });
  const summarize = useMutation({
    mutationFn: () => api.get(`/api/v1/ai/summarize-contact/${encodeURIComponent(contactId)}`),
  });
  const risks = useMutation({
    mutationFn: () => api.get('/api/v1/ai/deal-risks'),
  });
  const draft = useMutation({
    mutationFn: () => api.post('/api/v1/ai/draft-reply', { contactId, context: draftContext || undefined }),
  });
  const buildList = useMutation({
    mutationFn: () => api.post('/api/v1/ai/build-list', { query: listQuery }),
  });

  const anyConfigured = status.data?.configured;

  return (
    <div className="px-8 py-6 max-w-[1280px] mx-auto animate-fade-in">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-wide text-ink-500 font-medium">Email · IA</p>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink-900 mt-1">AI Assistant</h1>
            <p className="text-sm text-ink-500 mt-1 max-w-2xl">
              7 herramientas de IA que se apoyan en tu propio modelo (Anthropic, MiniMax, OpenAI).
              Las respuestas se persisten en el contacto o deal correspondiente.
            </p>
          </div>
          <div>
            {anyConfigured ? (
              <Badge tone="ok">conectado · {status.data?.model}</Badge>
            ) : (
              <Badge tone="warn">sin configurar</Badge>
            )}
          </div>
        </div>
        {!anyConfigured && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Configura <code className="font-mono">LLM_API_KEY</code> (y opcionalmente <code className="font-mono">LLM_BASE_URL</code>, <code className="font-mono">LLM_MODEL</code>) en Railway. Por defecto, el cliente LLM usa la API Anthropic-compatible — MiniMax funciona poniendo <code className="font-mono">LLM_BASE_URL=https://api.minimax.io/v1</code>.
          </p>
        )}
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        <nav className="space-y-1">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTool(t.key)}
              className={
                'w-full text-left rounded-lg border px-3 py-2 transition-colors ' +
                (activeTool === t.key
                  ? 'border-lime-300 bg-lime-50'
                  : 'border-ink-200 bg-paper hover:border-ink-300')
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{t.emoji}</span>
                <span className="text-sm font-semibold text-ink-900">{t.title}</span>
              </div>
              <p className="text-[11px] text-ink-500 mt-1 leading-snug">{t.blurb}</p>
            </button>
          ))}
        </nav>

        <main className="rounded-xl border border-ink-200 bg-paper p-5">
          {activeTool === 'enrich' && (
            <ToolPanel
              title="🪄 Enriquecer contacto"
              help="Pega nombre + email (empresa opcional) y la IA deduce cargo, seniority, sector, ubicación y tags sugeridos."
              result={enrich.data}
              error={enrich.error}
              loading={enrich.isPending}
              run={() => enrich.mutate()}
              runDisabled={!enrichName || !anyConfigured}
            >
              <Field label="Nombre">
                <Input value={enrichName} onChange={(e) => setEnrichName(e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Email (opcional)">
                <Input type="email" value={enrichEmail} onChange={(e) => setEnrichEmail(e.target.value)} placeholder="jane@acme.com" />
              </Field>
              <Field label="Empresa (opcional)">
                <Input value={enrichCompany} onChange={(e) => setEnrichCompany(e.target.value)} placeholder="Acme Inc." />
              </Field>
            </ToolPanel>
          )}

          {activeTool === 'extract' && (
            <ToolPanel
              title="✂️ Pegar firma / tarjeta / notas"
              help="Pega cualquier texto suelto (firma de email, tarjeta, meeting notes). La IA extrae los campos."
              result={extract.data}
              error={extract.error}
              loading={extract.isPending}
              run={() => extract.mutate()}
              runDisabled={rawText.length < 5 || !anyConfigured}
            >
              <Field label="Texto">
                <Textarea rows={6} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Juan Pérez · CEO en Acme · juan@acme.com · +34 600 000 000 · linkedin.com/in/jperez" />
              </Field>
            </ToolPanel>
          )}

          {(activeTool === 'score' || activeTool === 'summarize' || activeTool === 'draft') && (
            <ToolPanel
              title={TOOLS.find((t) => t.key === activeTool)!.title}
              help={TOOLS.find((t) => t.key === activeTool)!.blurb}
              result={
                activeTool === 'score' ? score.data :
                activeTool === 'summarize' ? summarize.data :
                draft.data
              }
              error={
                activeTool === 'score' ? score.error :
                activeTool === 'summarize' ? summarize.error :
                draft.error
              }
              loading={
                activeTool === 'score' ? score.isPending :
                activeTool === 'summarize' ? summarize.isPending :
                draft.isPending
              }
              run={() => {
                if (activeTool === 'score') score.mutate();
                else if (activeTool === 'summarize') summarize.mutate();
                else draft.mutate();
              }}
              runDisabled={!contactId || !anyConfigured}
            >
              <ContactPicker
                value={contactId}
                onChange={setContactId}
                contacts={(contacts.data?.items ?? []).map((c) => ({
                  id: c.id,
                  label: `${c.fullName}${c.email ? ` (${c.email})` : ''}`,
                }))}
              />
              {activeTool === 'draft' && (
                <Field label="Contexto / ángulo (opcional)">
                  <Textarea rows={3} value={draftContext} onChange={(e) => setDraftContext(e.target.value)} placeholder="Quiero pedirle 15 min para una demo la semana que viene." />
                </Field>
              )}
            </ToolPanel>
          )}

          {activeTool === 'risks' && (
            <ToolPanel
              title="🚨 Radar de riesgos"
              help="Escanea tu pipeline abierto y devuelve los 10 deals con más riesgo de caerse, con un siguiente paso concreto."
              result={risks.data}
              error={risks.error}
              loading={risks.isPending}
              run={() => risks.mutate()}
              runDisabled={!anyConfigured}
            >
              {(() => {
                const r = (risks.data as { result?: { risks?: Array<{ dealId: string; name: string; risk: string; signals: string[]; suggestedAction: string; valueMinor: number; daysSinceLastActivity: number }> } } | undefined)?.result?.risks;
                if (!r || !Array.isArray(r)) return null;
                return <RisksList risks={r} sequences={sequences.data ?? []} />;
              })()}
            </ToolPanel>
          )}

          {activeTool === 'list' && (
            <ToolPanel
              title="🎯 Lista inteligente"
              help="Escribe la pregunta en lenguaje natural. La IA la convierte a un filtro estructurado que puedes usar para crear listas."
              result={buildList.data}
              error={buildList.error}
              loading={buildList.isPending}
              run={() => buildList.mutate()}
              runDisabled={!listQuery || !anyConfigured}
            >
              <Field label="Pregunta">
                <Textarea rows={3} value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
              </Field>
            </ToolPanel>
          )}
        </main>
      </div>
    </div>
  );
}

function ContactPicker({
  value, onChange, contacts,
}: { value: string; onChange: (v: string) => void; contacts: Array<{ id: string; label: string }> }) {
  return (
    <Field label="Contacto">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-ink-200 bg-paper px-2.5 py-1.5 text-sm"
      >
        <option value="">— elige —</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </Field>
  );
}

function ToolPanel({
  title, help, children, result, error, loading, run, runDisabled,
}: {
  title: string; help: string;
  children: ReactNode;
  result: unknown; error: unknown; loading: boolean;
  run: () => void; runDisabled: boolean;
}) {
  return (
    <div>
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        <p className="text-[12px] text-ink-500 mt-1 max-w-prose">{help}</p>
      </header>
      <div className="space-y-3">{children}</div>
      <div className="mt-4 flex justify-end">
        <Button variant="accent" onClick={run} disabled={runDisabled || loading}>
          {loading ? 'Pensando…' : 'Ejecutar'}
        </Button>
      </div>
      <pre className="mt-4 rounded-md bg-ink-50 border border-ink-200 p-3 text-[12px] font-mono whitespace-pre-wrap break-words max-h-96 overflow-auto">
        {error ? `Error: ${(error as Error).message ?? 'fallo desconocido'}` :
         result ? JSON.stringify(result, null, 2) :
         'Sin ejecutar todavía.'}
      </pre>
    </div>
  );
}

function RisksList({
  risks, sequences,
}: {
  risks: Array<{ dealId: string; name: string; risk: string; signals: string[]; suggestedAction: string; valueMinor: number; daysSinceLastActivity: number }>;
  sequences: Sequence[];
}) {
  if (risks.length === 0) {
    return <p className="text-sm text-ink-500">Sin deals abiertos o sin riesgos detectados. ¡Bien!</p>;
  }
  return (
    <div className="space-y-2 mt-3 max-h-96 overflow-auto">
      {risks.map((r) => (
        <div key={r.dealId} className="rounded-md border border-ink-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <Link to={`/email/sequences/${sequences.find((s) => s.id === r.dealId)?.id ?? ''}`} className="font-semibold text-ink-900 hover:underline">
              {r.name}
            </Link>
            <Badge tone={r.risk === 'high' ? 'bad' : r.risk === 'medium' ? 'warn' : 'ok'}>
              {r.risk}
            </Badge>
          </div>
          <p className="text-[12px] text-ink-600 mt-1">
            {(r.valueMinor / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })} ·
            {' '}última actividad hace {r.daysSinceLastActivity} días
          </p>
          {r.signals.length > 0 && (
            <ul className="text-[12px] text-ink-600 mt-2 list-disc pl-5 space-y-0.5">
              {r.signals.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <p className="text-[12px] text-ink-900 mt-2 font-medium">→ {r.suggestedAction}</p>
        </div>
      ))}
    </div>
  );
}
