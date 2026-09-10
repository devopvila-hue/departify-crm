import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Badge } from '../design-system/Badge';
import { SkeletonRows } from '../design-system/Skeleton';
import { EmptyState } from '../design-system/EmptyState';
import { formatShortDate, relativeFromNow, time as fmtTime } from '../../lib/format';

/**
 * Activity timeline — the commercial memory of the CRM.
 *
 * Shared by the global Actividad tab and by each record (company /
 * person / deal), so an event reads the same everywhere. Events are
 * grouped by day (Hoy / Ayer / Esta semana / Anterior) and every event
 * links back to its subject when the UI knows the id.
 */

export type ActivityType =
  | 'note'
  | 'email'
  | 'call'
  | 'meeting'
  | 'task'
  | 'status_change'
  | 'deal_change'
  | 'sequence_event'
  | 'system_event';

export interface ActivityItemData {
  id: string;
  type: ActivityType;
  title: string;
  body?: string | null;
  subjectType: 'contact' | 'company' | 'deal' | 'organization';
  subjectId: string;
  subjectName?: string | null;
  actorName?: string | null;
  createdAt: string;
}

const TYPE_META: Record<ActivityType, { label: string; tone: 'neutral' | 'lime' | 'warn' | 'bad' | 'ok' | 'blue' }> = {
  note: { label: 'Nota', tone: 'neutral' },
  email: { label: 'Email', tone: 'blue' },
  call: { label: 'Llamada', tone: 'lime' },
  meeting: { label: 'Reunión', tone: 'ok' },
  task: { label: 'Tarea', tone: 'neutral' },
  status_change: { label: 'Etapa', tone: 'warn' },
  deal_change: { label: 'Oportunidad', tone: 'ok' },
  sequence_event: { label: 'Secuencia', tone: 'neutral' },
  system_event: { label: 'Sistema', tone: 'neutral' },
};

function TypeIcon({ type }: { type: ActivityType }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'note':
      return <svg {...common}><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></svg>;
    case 'email':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
    case 'call':
      return <svg {...common}><path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" /></svg>;
    case 'meeting':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
    case 'deal_change':
    case 'status_change':
      return <svg {...common}><path d="M4 17V9M10 17V5M16 17v-6M20 17V7" /></svg>;
    case 'task':
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 12l2 2 4-4" /></svg>;
    case 'sequence_event':
      return <svg {...common}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7l8 4M8 17l8-4" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2 2" /></svg>;
  }
}

function subjectHref(a: ActivityItemData): string | null {
  switch (a.subjectType) {
    case 'company': return `/companies/${a.subjectId}`;
    case 'contact': return `/contacts/${a.subjectId}`;
    case 'deal': return `/deals/${a.subjectId}`;
    default: return null;
  }
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return 'Hoy';
  if (t >= startToday - 86_400_000) return 'Ayer';
  if (t >= startToday - 6 * 86_400_000) return 'Esta semana';
  return 'Anterior';
}

const BUCKET_ORDER = ['Hoy', 'Ayer', 'Esta semana', 'Anterior'];

export function ActivityFeed({
  items,
  loading,
  emptyTitle = 'Sin actividad todavía',
  emptyDescription = 'Cuando muevas una oportunidad, añadas una nota o se registre un email, aparecerá aquí.',
  showSubject = true,
}: {
  items: ActivityItemData[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  showSubject?: boolean;
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (items.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  const groups = new Map<string, ActivityItemData[]>();
  for (const a of items) {
    const b = dayBucket(a.createdAt);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b)!.push(a);
  }

  return (
    <div className="space-y-5">
      {BUCKET_ORDER.filter((b) => groups.has(b)).map((bucket) => (
        <section key={bucket}>
          <h3 className="text-[11px] uppercase tracking-wide text-ink-500 font-medium mb-2">{bucket}</h3>
          <ol className="card divide-y divide-ink-100 overflow-hidden">
            {groups.get(bucket)!.map((a) => (
              <ActivityRow key={a.id} activity={a} showSubject={showSubject} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function ActivityRow({ activity: a, showSubject = true }: { activity: ActivityItemData; showSubject?: boolean }) {
  const meta = TYPE_META[a.type] ?? TYPE_META.system_event;
  const href = subjectHref(a);
  const isToday = dayBucket(a.createdAt) === 'Hoy';
  const when = isToday ? fmtTime.format(new Date(a.createdAt)) : `${formatShortDate(a.createdAt)} · ${relativeFromNow(a.createdAt)}`;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={clsx(
          'mt-0.5 size-7 shrink-0 rounded-full grid place-items-center border',
          meta.tone === 'blue' && 'bg-sky-50 text-sky-700 border-sky-200',
          meta.tone === 'lime' && 'bg-lime-50 text-lime-700 border-lime-200',
          meta.tone === 'ok' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
          meta.tone === 'warn' && 'bg-amber-50 text-amber-700 border-amber-200',
          meta.tone === 'bad' && 'bg-red-50 text-red-700 border-red-200',
          meta.tone === 'neutral' && 'bg-ink-100 text-ink-600 border-ink-200',
        )}
        aria-hidden
      >
        <TypeIcon type={a.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm text-ink-900">{a.title}</p>
          {showSubject && a.subjectName && (
            href ? (
              <Link to={href} className="text-[12px] text-ink-600 hover:text-ink-900 hover:underline">
                {a.subjectName}
              </Link>
            ) : (
              <span className="text-[12px] text-ink-500">{a.subjectName}</span>
            )
          )}
        </div>
        {a.body && <p className="text-[12px] text-ink-500 mt-0.5 line-clamp-2">{a.body}</p>}
        <p className="text-[11px] text-ink-400 mt-1">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="ml-2">{when}</span>
          {a.actorName ? <span className="ml-1">· {a.actorName}</span> : null}
        </p>
      </div>
    </li>
  );
}