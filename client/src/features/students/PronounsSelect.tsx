import type { SelectHTMLAttributes } from 'react';

const PRONOUN_OPTIONS = ['He/Him', 'She/Her', 'They/Them', 'Other'] as const;

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-subtle bg-base px-2 text-base text-primary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

interface PronounsSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  /** Raw stored value; '' means not specified. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Fixed pronoun set for Phase 1. A stored free-text value that does not match
 * an option displays as "Other"; saving in that state overwrites it with the
 * literal `Other` (accepted tradeoff per the 3b plan).
 */
export function PronounsSelect({ value, onChange, className = '', ...rest }: PronounsSelectProps) {
  const display =
    value === '' || (PRONOUN_OPTIONS as readonly string[]).includes(value) ? value : 'Other';
  return (
    <select
      value={display}
      onChange={(e) => onChange(e.target.value)}
      className={`${SELECT_CLASS} ${className}`}
      {...rest}
    >
      <option value="">Not specified</option>
      {PRONOUN_OPTIONS.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
