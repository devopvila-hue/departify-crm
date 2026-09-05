import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-9 w-full rounded-md border bg-white px-3 text-sm placeholder:text-ink-400',
        'focus:border-ink-400 focus:shadow-ring focus:outline-none',
        invalid ? 'border-signal-bad' : 'border-ink-200',
        className,
      )}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={clsx(
        'min-h-[88px] w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-ink-400',
        'focus:border-ink-400 focus:shadow-ring focus:outline-none',
        invalid ? 'border-signal-bad' : 'border-ink-200',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-700">{label}</span>
      {children}
      {hint && !error && <span className="text-[11px] text-ink-500">{hint}</span>}
      {error && <span className="text-[11px] text-signal-bad">{error}</span>}
    </label>
  );
}
