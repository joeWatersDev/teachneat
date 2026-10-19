import type { SelectHTMLAttributes } from 'react';

const SELECT =
  'h-9 rounded-md border border-subtle bg-base px-2 text-base text-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The shared styled `<select>` used for every dropdown in the app (class
 * scoping, roster filters, sort). Callers supply their own `<label>` and
 * `<option>`s; this only owns the consistent field styling that used to be a
 * `SELECT_CLASS` string duplicated per feature.
 */
export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${SELECT} ${className}`} {...rest}>
      {children}
    </select>
  );
}
