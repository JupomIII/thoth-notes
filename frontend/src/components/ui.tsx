import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 h-10 text-[14px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap';
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-paper-raised hover:bg-accent-strong',
    secondary: 'bg-paper-raised border border-line text-ink hover:bg-paper-sunken',
    ghost: 'text-ink-soft hover:bg-paper-sunken',
    danger: 'bg-danger text-white hover:brightness-95',
  };
  return (
    <button type="button" className={cx(base, styles[variant], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-accent text-paper-raised' : 'text-ink-soft hover:bg-paper-sunken',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div
        className={cx(
          'animate-in w-full overflow-hidden rounded-t-2xl border border-line bg-paper-raised shadow-float sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-serif text-[19px] leading-tight text-ink">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 h-9 w-9">
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </div>
        {children && (
          <div className="thin-scroll max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        )}
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,var(--safe-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-11 w-full rounded-lg border border-line bg-paper px-3 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:border-accent',
        props.className,
      )}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <div className="text-[15px] text-ink">{label}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-paper-sunken',
        )}
      >
        <span
          className={cx(
            'block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-[13px] transition-colors',
            value === option.value
              ? 'bg-paper-raised text-ink shadow-sm'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent',
        className,
      )}
      aria-hidden
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-paper-raised/60 px-6 py-16 text-center">
      <h3 className="font-serif text-[20px] text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="safe-px flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-paper/90 py-3 pt-[max(0.75rem,var(--safe-top))] backdrop-blur">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="-ml-2 px-2" aria-label="Back">
          <span className="text-[15px]">Back</span>
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-[22px] leading-tight text-ink">{title}</h1>
        {subtitle && <p className="truncate text-[12.5px] text-ink-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5">{actions}</div>
    </header>
  );
}
