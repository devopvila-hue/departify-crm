import clsx from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'lime' | 'warn' | 'bad' | 'ok' | 'blue';

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  lime: 'bg-lime-50 text-lime-700 border-lime-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}
