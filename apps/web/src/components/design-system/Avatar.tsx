import { initials } from '../../lib/format';
import clsx from 'clsx';

const palette = [
  'bg-lime-100 text-lime-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const tone = palette[hash(name) % palette.length];
  return (
    <span
      className={clsx('inline-grid place-items-center rounded-full font-semibold', tone, className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {initials(name) || '·'}
    </span>
  );
}
