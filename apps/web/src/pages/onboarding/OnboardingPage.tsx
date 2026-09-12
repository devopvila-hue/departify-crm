/**
 * DEPARTIFY CRM — onboarding page (PURE DISPLAY of system state).
 *
 * Rules:
 *  - Cards are display only. No handler that calls /onboarding/move.
 *  - Backend state drives everything. UI never mutates prep cards.
 *  - "readyForWork" decides when the hero line says "[Empresa] está lista".
 *  - Optional cards (Calendar/Mail/Drive) are honest "available_later" —
 *    never pretended ready.
 *  - No "no cierres esta ventana". No spinner that traps the user.
 *  - Refresh / re-entry is safe: re-fetches the state and renders.
 *
 * The page is allowed to refresh data periodically so the user can see
 * real backend transitions (e.g. a real connection finishing). The user
 * can always navigate away and come back. There is NO wizard.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/design-system/Toast';

type CardKey = 'company' | 'workspace' | 'calendar' | 'mail' | 'drive';
type CardState = 'waiting' | 'preparing' | 'ready' | 'needs_permission' | 'available_later' | 'skipped' | 'error';

interface PrepState {
  organizationId: string;
  phase: string;
  cards: Partial<Record<CardKey, CardState>>;
  readyForWork: boolean;
  allConnectionsReady: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

const CARD_LABELS: Record<CardKey, string> = {
  company: 'Empresa',
  workspace: 'Tu espacio de trabajo',
  calendar: 'Calendario',
  mail: 'Correo',
  drive: 'Documentos',
};

const CARD_HINTS: Record<CardKey, string> = {
  company: 'Tu organización y la forma de trabajar',
  workspace: 'El espacio donde trabajas cada día',
  calendar: 'Tus reuniones y tu tiempo',
  mail: 'Tus correos y tus bandejas',
  drive: 'Tus documentos y archivos',
};

/** Honest copy for each card state. No fake "preparing… puede tardar". */
const CARD_COPY: Record<CardState, { line: string; tone: 'ok' | 'pending' | 'later' | 'attention' }> = {
  ready: { line: 'Lista', tone: 'ok' },
  preparing: { line: 'Preparando…', tone: 'pending' },
  waiting: { line: 'En cola…', tone: 'pending' },
  needs_permission: { line: 'Necesita tu permiso para continuar', tone: 'attention' },
  available_later: { line: 'Puedes conectarlo después', tone: 'later' },
  skipped: { line: 'Lo dejamos para más adelante', tone: 'later' },
  error: { line: 'Lo revisaremos más tarde', tone: 'attention' },
};

/** Visual order is: built capabilities first, optionals after. */
const CARD_ORDER: CardKey[] = ['company', 'workspace', 'calendar', 'mail', 'drive'];

function toneClasses(tone: 'ok' | 'pending' | 'later' | 'attention'): string {
  switch (tone) {
    case 'ok':
      return 'bg-lime-100 text-lime-700';
    case 'attention':
      return 'bg-amber-100 text-amber-800';
    case 'later':
      return 'bg-ink-100 text-ink-500';
    default:
      return 'bg-ink-100 text-ink-600';
  }
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<PrepState | null>(null);
  const [loading, setLoading] = useState(true);
  const startedRef = useRef(false);

  const orgName = me?.orgName ?? 'Tu empresa';

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick(): Promise<void> {
      try {
        const next = await api.get<PrepState>('/api/v1/onboarding');
        if (cancelled) return;
        setState(next);

        // If the backend is preparing something in real time, poll until
        // it settles. We only poll while a BUILT capability is preparing
        // (not for `available_later`, which is terminal).
        const anyBuiltPreparing = Object.entries(next.cards).some(
          ([, v]) => v === 'preparing' || v === 'waiting',
        );
        if (anyBuiltPreparing && startedRef.current === false) {
          // Run real setup exactly once per mount, then poll.
          startedRef.current = true;
          try {
            const started = await api.post<PrepState>('/api/v1/onboarding/start', {});
            if (!cancelled) setState(started);
          } catch {
            /* tolerate; tick again to retry */
          }
          timer = setTimeout(() => void tick(), 1500);
          return;
        }
        if (anyBuiltPreparing) {
          timer = setTimeout(() => void tick(), 2000);
          return;
        }
      } catch {
        if (!cancelled) {
          toast.push({ tone: 'bad', title: 'No se pudo cargar la preparación' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readyForWork = state?.readyForWork === true;
  const phase = state?.phase ?? 'preparing';

  return (
    <div className="min-h-dvh bg-ink-50">
      <div className="mx-auto max-w-xl px-4 py-10 animate-fade-in">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wide font-medium text-ink-500">Onboarding</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 md:text-3xl">
            {readyForWork ? (
              <>
                {orgName} <span className="text-lime-600">está lista</span>
              </>
            ) : (
              <>Estoy preparando {orgName}</>
            )}
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {readyForWork
              ? 'Ya puedes trabajar con Departify. Conecta lo que quieras cuando quieras.'
              : 'Yo me encargo. Puedes seguir y volver cuando quieras.'}
          </p>
        </header>

        <div className="space-y-3" role="list" aria-busy={loading ? 'true' : 'false'}>
          {CARD_ORDER.map((key) => {
            const cardState: CardState = state?.cards[key] ?? 'waiting';
            const copy = CARD_COPY[cardState];
            const hint = CARD_HINTS[key];
            return (
              <div
                key={key}
                role="listitem"
                className="card flex items-start gap-4 px-5 py-4"
                data-state={cardState}
                aria-label={`${CARD_LABELS[key]}: ${copy.line}`}
              >
                <div
                  className={`grid size-9 shrink-0 place-items-center rounded-full ${toneClasses(copy.tone)}`}
                  aria-hidden
                >
                  {cardState === 'ready' ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12l5 5L20 6" />
                    </svg>
                  ) : cardState === 'preparing' ? (
                    <span className="inline-block size-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                  ) : (
                    <span className="inline-block size-2 rounded-full bg-current" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{CARD_LABELS[key]}</p>
                  <p className="mt-0.5 text-[12px] text-ink-500">{hint}</p>
                </div>
                <div className="shrink-0">
                  <p className={`text-[12px] font-medium ${copy.tone === 'ok' ? 'text-lime-700' : copy.tone === 'attention' ? 'text-amber-700' : copy.tone === 'later' ? 'text-ink-500' : 'text-ink-600'}`}>
                    {copy.line}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            className="text-[12px] text-ink-500 hover:text-ink-700"
            onClick={() => navigate('/', { replace: true })}
          >
            Seguir sin esperar
          </button>
          {readyForWork ? (
            <button
              type="button"
              className="btn-accent"
              onClick={() => navigate('/', { replace: true })}
            >
              Entrar en Departify
            </button>
          ) : (
            <span className="text-[12px] text-ink-400" data-phase={phase}>
              {state ? '' : 'Cargando…'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
