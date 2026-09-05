import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

type Tone = 'ok' | 'warn' | 'bad' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, ...t }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'card-pop px-4 py-3 animate-fade-in',
              t.tone === 'ok' && 'border-emerald-200',
              t.tone === 'warn' && 'border-amber-200',
              t.tone === 'bad' && 'border-red-200',
            )}
          >
            <p className="text-sm font-semibold text-ink-900">{t.title}</p>
            {t.body && <p className="text-[12px] text-ink-600 mt-0.5">{t.body}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
