/**
 * OnboardingGate — redirects a user into the onboarding preparation flow
 * when their organization hasn't finished it (phase not in ready-ish set).
 * Idempotent and read-only: it never writes, so refresh is safe.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export function OnboardingGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const redirectedRef = useRef(false);
  const readyRef = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'onboarding'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prep = await api.get<{ phase: string }>('/api/v1/onboarding');
        if (cancelled) return;
        if (prep.phase === 'ready' || prep.phase === 'partial' || prep.phase === 'needs_attention') {
          readyRef.current = true;
          setState('ready');
        } else {
          setState('onboarding');
        }
      } catch {
        if (cancelled) return;
        // No onboarding row → treat as not started → send to onboarding.
        setState('onboarding');
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
  // While loading the phase, render nothing (avoids flashing the app).
  if (state === 'loading') {
    return <div className="grid min-h-dvh place-items-center bg-ink-50"><span className="inline-block size-5 rounded-full border-2 border-ink-300 border-r-transparent animate-spin" /></div>;
  }
  return <>{children}</>;
}