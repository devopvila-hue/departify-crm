/**
 * useGoogleCapabilities — verify and register Google OAuth capabilities in the CRM.
 *
 * Called once on app mount for authenticated users. This hook:
 *   1. Reads the Supabase session (provider_token = Google access token)
 *   2. Verifies each capability (Gmail/Calendar/Drive) with a real API probe
 *   3. POSTs only the PROVEN capabilities to the CRM's register-scopes endpoint
 *
 * Principle: we never register a scope we haven't actually proven. If Gmail
 * rejects the token, Gmail scope is NOT registered — even if the token exists.
 * This keeps the CRM's external_grants.scopes as EVIDENCE, not a claim.
 *
 * Supabase is NOT replaced. We read the session it already manages and use
 * the Google access_token inside it for API probes.
 */
import { useEffect } from 'react';
import { api } from '../lib/api';



/** Keys in localStorage where Supabase v1 stores session data. */
function getSupabaseSession(): { provider_token?: string; user?: { email?: string } } | null {
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.currentSession ?? null;
  } catch {
    return null;
  }
}

/**
 * Probe Google APIs with the access token.
 * Returns only the capabilities that return 2xx — proving real authorization.
 */
async function probeGoogleCapabilities(accessToken: string): Promise<{
  gmail: boolean;
  calendar: boolean;
  drive: boolean;
  scopes: string[];
}> {
  const results = { gmail: false, calendar: false, drive: false };
  const scopesFound: string[] = [];

  // Probe Gmail (list first message, minimal read-only call)
  try {
    const gr = await fetch(
      'https://www.googleapis.com/gmail/v1/messages?maxResults=1',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (gr.ok) {
      results.gmail = true;
      scopesFound.push('https://www.googleapis.com/auth/gmail.readonly');
    } else if (gr.status === 401) {
      // Token expired or revoked
    }
  } catch { /* network error — capability not available */ }

  // Probe Calendar (list events, minimal read-only call)
  try {
    const cr = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (cr.ok) {
      results.calendar = true;
      scopesFound.push('https://www.googleapis.com/auth/calendar.events');
    }
  } catch { /* network error */ }

  // Probe Drive (list files, minimal read-only call)
  try {
    const dr = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=files(id,name)&pageSize=1',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (dr.ok) {
      results.drive = true;
      scopesFound.push('https://www.googleapis.com/auth/drive.readonly');
    }
  } catch { /* network error */ }

  return { ...results, scopes: scopesFound };
}

export function useGoogleCapabilities() {
  useEffect(() => {
    let cancelled = false;

    async function registerCapabilities() {
      const session = getSupabaseSession();
      const accessToken = session?.provider_token;
      if (!accessToken) return;

      // Probe each capability with a real API call.
      const { scopes } = await probeGoogleCapabilities(accessToken);

      if (cancelled || !scopes.length) return;

      try {
        const res = await api.post<{ ok: boolean; capabilities: string[] }>(
          '/api/v1/auth/oauth/google/register-scopes',
          { scopes, providerEmail: session.user?.email },
        );
        console.info('[useGoogleCapabilities] Verified & registered:', res.capabilities);
      } catch (err) {
        console.warn('[useGoogleCapabilities] Failed to register:', err);
      }
    }

    void registerCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);
}
