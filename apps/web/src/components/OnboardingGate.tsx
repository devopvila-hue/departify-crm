/**
 * OnboardingGate — entry gate for the protected shell.
 *
 * Reads the prep state from the backend. If `readyForWork` is true, the
 * shell renders; otherwise the user is sent to /onboarding (which runs
 * the real setup on entry). The gate never pretends work is happening:
 * it is read-only and idempotent, so refreshing is always safe.
 *
 * The gate does NOT poll, does NOT call /start. The /onboarding page is
 * the single place that triggers system-driven setup; the gate only
 * checks the resulting state.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface PrepResponse {
  readyForWork: boolean;
  phase: string;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const redirectedRef = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'onboarding'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prep = await api.get<PrepResponse>('/api/v1/onboarding');
        if (cancelled) return;
        if (prep.readyForWork) setState('ready');
        else setState('onboarding');
      } catch {
        if (cancelled) return;
        // Backend unreachable → don't block the user; let the shell render.
        // Real auth still applies (Protected wrapper). OnboardingPage can
        // re-attempt /start on its own.
        setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state === 'onboarding' && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate('/onboarding', { replace: true });
    }
  }, [state, navigate]);

  if (state === 'onboarding') return null;
  if (state === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-50" aria-busy="true">
        <span className="inline-block size-5 rounded-full border-2 border-ink-300 border-r-transparent animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}
