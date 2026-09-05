/**
 * Small formatting helpers used across screens.
 * Locale: Spain Spanish (es-ES), EUR default.
 */
export const eur = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export const compactEur = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const date = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
export const shortDate = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' });
export const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function formatMoney(minor: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return date.format(typeof d === 'string' ? new Date(d) : d);
}

export function formatShortDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return shortDate.format(typeof d === 'string' ? new Date(d) : d);
}

export function relativeFromNow(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const day = 1000 * 60 * 60 * 24;
  const days = Math.round(abs / day);
  const rtf = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / day), 'day');
  void days;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
