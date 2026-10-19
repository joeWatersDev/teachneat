import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

const BASE =
  'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-base font-semibold ' +
  'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

const VARIANTS: Record<Variant, string> = {
  // Accent background takes dark text for contrast (DESIGN_SYSTEM accent rules).
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-subtle bg-elevated text-primary hover:bg-hover',
  danger: 'border border-subtle bg-elevated text-danger hover:bg-danger-bg',
};

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : children}
    </button>
  );
}
