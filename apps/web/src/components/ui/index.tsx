import {
  createContext, forwardRef, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Bouton                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-sm disabled:bg-[var(--border-strong)] disabled:text-[var(--text-muted)]',
  secondary:
    'bg-[var(--surface-overlay)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110',
  subtle: 'bg-[var(--accent-soft)] text-[var(--accent-text)] hover:brightness-125',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, full, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-[10px] font-medium transition-all',
        'disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Cartes et sections                                                  */
/* ------------------------------------------------------------------ */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <div className={clsx('surface', className)} style={{ boxShadow: 'var(--shadow-card)' }} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title, description, action, icon,
}: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-secondary-fg">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-secondary-fg">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Champs de formulaire                                                */
/* ------------------------------------------------------------------ */

export function Field({
  label, hint, error, required, children, htmlFor,
}: {
  label?: ReactNode; hint?: ReactNode; error?: string; required?: boolean;
  children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-[13px] font-medium text-secondary-fg">
          {label}
          {required ? <span className="text-[var(--danger)]">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-[12px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted-fg">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-[10px] border bg-[var(--surface-base)] px-3 text-sm text-[var(--text-primary)] ' +
  'placeholder:text-[var(--text-muted)] transition-colors ' +
  'border-[var(--border-strong)] hover:border-[var(--text-muted)] ' +
  'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(CONTROL_BASE, 'h-10', invalid && 'border-[var(--danger)]', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(CONTROL_BASE, 'min-h-24 resize-y py-2.5 leading-relaxed', invalid && 'border-[var(--danger)]', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={clsx(CONTROL_BASE, 'h-10 appearance-none pr-9', className)} {...rest}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden
        />
      </div>
    );
  },
);

export function Switch({
  checked, onChange, label, description, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex items-start gap-3', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
        )}
      >
        <span
          className={clsx(
            'block size-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-sm">{label}</span> : null}
          {description ? <span className="block text-[12px] text-muted-fg">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/** Selection segmentee : plus lisible qu'un menu pour 2 a 6 options courtes. */
export function SegmentedControl<T extends string>({
  value, options, onChange, size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-1 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)] p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          title={option.title}
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-[7px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]',
            value === option.value
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Indicateurs                                                         */
/* ------------------------------------------------------------------ */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-hover)] text-[var(--text-secondary)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
};

export function Badge({
  tone = 'neutral', children, icon, className,
}: { tone?: BadgeTone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'danger' }) {
  const color = { accent: 'var(--accent)', success: 'var(--success)', danger: 'var(--danger)' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Etats                                                               */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

export function EmptyState({
  icon, title, description, action,
}: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[var(--surface-hover)] text-[var(--text-muted)]">
          {icon}
        </span>
      ) : null}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] text-secondary-fg">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Chargement impossible', description, onRetry,
}: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle className="size-5 text-[var(--danger)]" />}
      title={title}
      description={description ?? "Les donnees n'ont pas pu etre recuperees."}
      action={onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Reessayer</Button> : undefined}
    />
  );
}

export function InlineNotice({
  tone = 'info', title, children, icon,
}: { tone?: BadgeTone; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const border = {
    neutral: 'var(--border-strong)', accent: 'var(--accent)', success: 'var(--success)',
    warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)',
  }[tone];
  return (
    <div
      className="flex gap-3 rounded-[10px] border-l-2 bg-[var(--surface-base)] px-4 py-3 text-[13px]"
      style={{ borderLeftColor: border }}
    >
      {icon ?? <Info className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-secondary-fg">{children}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modale                                                              */
/* ------------------------------------------------------------------ */

export function Modal({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode;
  children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'animate-fade-up relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-[var(--surface-raised)] sm:rounded-2xl',
          'border border-[var(--border-subtle)]',
          width,
        )}
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-[13px] text-secondary-fg">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="size-4" />
          </button>
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-base)] px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation d'une operation destructive.
 * `confirmWord` impose de recopier une valeur exacte : la validation reelle
 * est refaite cote serveur, ce dialogue n'est qu'un garde-fou d'interface.
 */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel = 'Confirmer',
  tone = 'danger', consequences, confirmWord, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string;
  description?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary';
  consequences?: string[]; confirmWord?: string; loading?: boolean;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const canConfirm = !confirmWord || typed.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={!canConfirm}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {consequences?.length ? (
        <div className="mb-4 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[var(--danger)]">
            <AlertTriangle className="size-3.5" aria-hidden />
            Cette action est irreversible
          </p>
          <ul className="space-y-1 text-[13px] text-secondary-fg">
            {consequences.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirmWord ? (
        <Field label={<>Saisissez <span className="font-mono text-[var(--text-primary)]">{confirmWord}</span> pour confirmer</>}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit etre utilise dans ToastProvider.');
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = (tone: Toast['tone'], title: string, description?: string) => {
    counter.current += 1;
    const toast: Toast = { id: counter.current, tone, title, description };
    setToasts((current) => [...current.slice(-3), toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== toast.id));
    }, tone === 'error' ? 7000 : 4500);
  };

  const value: ToastApi = {
    success: (title, description) => push('success', title, description),
    error: (title, description) => push('error', title, description),
    info: (title, description) => push('info', title, description),
  };

  const icons = {
    success: <Check className="size-4 text-[var(--success)]" />,
    error: <AlertTriangle className="size-4 text-[var(--danger)]" />,
    info: <Info className="size-4 text-[var(--info)]" />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-fade-up pointer-events-auto flex gap-3 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-overlay)] p-3.5"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            <span className="mt-0.5">{icons[toast.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-[12px] text-secondary-fg">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="-mt-1 -mr-1 h-fit rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const label = name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '').join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      aria-hidden
    >
      {label}
    </span>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--surface-overlay)] px-2 py-1 text-[11px] text-[var(--text-primary)] shadow-lg group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}

export function StatTile({
  label, value, hint, icon, tone = 'neutral', loading,
}: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode;
  tone?: BadgeTone; loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-secondary-fg">{label}</p>
        {icon ? (
          <span className={clsx('flex size-7 items-center justify-center rounded-lg', BADGE_TONES[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      )}
      {hint ? <p className="mt-1 text-[12px] text-muted-fg">{hint}</p> : null}
    </Card>
  );
}
