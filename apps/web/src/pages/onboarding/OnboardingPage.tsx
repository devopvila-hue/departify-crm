/**
 * DEPARTIFY — onboarding preparation experience.
 *
 * Zero-question flow:
 *   auth → "Departify está preparando tu empresa" → work cards
 *   → [Empresa] está lista → Entrar en Departify
 *
 * Every card derives from the real onboarding_prep state served by
 * /api/v1/onboarding. No fake timers, no fake percentages: the phase and
 * the card states ARE the progress. If a capability isn't connected yet
 * the user simply sees "Lo terminaremos después" — completion is never
 * blocked by optional connections.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/design-system/Button';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/design-system/Toast';

type Phase = 'not_started' | 'preparing' | 'ready' | 'partial' | 'needs_attention';
type CardState = 'waiting' | 'preparing' | 'ready' | 'needs_permission' | 'skipped' | 'error';

interface PrepState {
  organizationId: string;
  phase: Phase;
  cards: Record<string, CardState>;
  startedAt: string | null;
  completedAt: string | null;
}

const CARD_LABELS: Record<string, string> = {
  company: 'Empresa',
  calendar: 'Calendario',
  mail: 'Correo',
  drive: 'Documentos',
  workspace: 'Tu espacio de trabajo',
};

const CARD_DESC: Record<string, string> = {
  company: 'Tu organización y la forma de trabajar',
  calendar: 'Tu tiempo y tus reuniones',
  mail: 'Tus correos y tus bandejas',
  drive: 'Tus documentos y archivos',
  workspace: 'El espacio donde trabajas cada día',
};

function stateCopy(state: CardState): string {
  switch (state) {
    case 'preparing': return 'Preparando…';
    case 'ready': return 'Listo';
    case 'needs_permission': return 'Esperando tu permiso…';
    case 'skipped': return 'Lo terminaremos después';
    case 'error': return 'Lo revisaremos más tarde';
    default: return 'En cola…';
  }
}

const PHASE_COPY: Record<Phase, { title: string; body: string }> = {
  not_started: { title: 'Preparando tu empresa', body: 'Estoy preparando Departify para tu empresa. Tú no tienes que configurar nada.' },
  preparing: { title: 'Preparando tu empresa', body: 'Estoy preparando Departify para tu empresa. Tú no tienes que configurar nada.' },
  ready: { title: 'está lista', body: 'Ya puedes trabajar con Departify. Conecta lo que quieras cuando quieras.' },
  partial: { title: 'está casi lista', body: 'Ya puedes entrar. Conecta lo que quieras cuando quieras.' },
  needs_attention: { title: 'está casi lista', body: 'Algo necesita tu atención, pero puedes entrar y seguir trabajando.' },
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const toast = useToast();
  const [prep, setPrep] = useState<PrepState | null>(null);
  const [busy, setBusy] = useState(false);

  const orgName = me?.orgName ?? 'Tu empresa';

  const load = async () => {
    try {
      const state = await api.get<PrepState>('/api/v1/onboarding');
      setPrep(state);
      if (state.phase === 'not_started') {
        // Begin real preparation: record the company card as preparing.
        const started = await api.post<PrepState>('/api/v1/onboarding/start', { cards: { company: 'preparing' } });
        setPrep(started);
      }
    } catch {
      toast.push({ tone: 'bad', title: 'No se pudo cargar la preparación' });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enter = async () => {
    setBusy(true);
    if (prep && (prep.phase === 'not_started' || prep.phase === 'preparing')) {
      try {
        // Duplicate-safety: if nothing moved, mark company ready so the
        // user is never trapped in "preparing" forever.
        await api.post<PrepState>('/api/v1/onboarding/move', { card: 'company', state: 'ready' });
      } catch {
        /* fallthrough: entering is never blocked */
      }
    }
    navigate('/', { replace: true });
  };

  const phase = prep?.phase ?? 'preparing';
  const copy = PHASE_COPY[phase];
  const cards = prep?.cards ?? {};
  const cardEntries = Object.keys(CARD_LABELS).map((key) => [key, cards[key] ?? 'waiting'] as const);
  const ready = phase === 'ready' || phase === 'partial' || phase === 'needs_attention';

  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-xl animate-fade-in">
        <header className="text-center mb-8">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-lime-100 text-lime-700">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 md:text-3xl">
            {ready ? (
              <>
                {orgName} <span className="text-lime-600">{copy.title}</span>
              </>
            ) : (
              copy.title
            )}
          </h1>
          <p className="mt-2 text-sm text-ink-500">{copy.body}</p>
          {!ready && (
            <p className="mt-3 text-[12px] text-ink-400" aria-live="polite">
              Esto puede tardar unos segundos. No cierres esta ventana.
            </p>
          )}
        </header>

        <div className="space-y-3">
          {cardEntries.map(([key, state]) => (
            <div
              key={key}
              className="card flex items-center gap-4 px-5 py-4"
              data-state={state}
            >
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-full ${
                  state === 'ready'
                    ? 'bg-lime-100 text-lime-700'
                    : state === 'error' || state === 'needs_permission'
                      ? 'bg-signal-warn/10 text-signal-warn'
                      : state === 'preparing'
                        ? 'bg-ink-100 text-ink-600'
                        : 'bg-ink-50 text-ink-300'
                }`}
                aria-hidden
              >
                {state === 'ready' ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                ) : state === 'preparing' ? (
                  <span className="inline-block size-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                ) : (
                  <span className="inline-block size-2 rounded-full bg-current" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{CARD_LABELS[key]}</p>
                <p className="text-[12px] text-ink-500">{CARD_DESC[key]}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-[12px] font-medium ${
                    state === 'ready'
                      ? 'text-lime-700'
                      : state === 'error' || state === 'needs_permission'
                        ? 'text-signal-warn'
                        : state === 'preparing'
                          ? 'text-ink-600'
                          : 'text-ink-400'
                  }`}
                >
                  {stateCopy(state)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {ready && (
          <div className="mt-8 text-center animate-fade-in">
            <Button variant="accent" size="lg" className="w-full sm:w-auto sm:px-10" onClick={enter} loading={busy}>
              Entrar en Departify
            </Button>
            {phase !== 'ready' && (
              <p className="mt-3 text-[12px] text-ink-400">
                Las conexiones que falten las completaremos después.
              </p>
            )}
          </div>
        )}

        {!ready && (
          <div className="mt-8 text-center">
            <Button variant="ghost" size="md" onClick={enter} loading={busy}>
              Entrar de todas formas
            </Button>
            <p className="mt-2 text-[11px] text-ink-400">
              No estás obligado a esperar: puedes entrar y preparar el resto después.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}