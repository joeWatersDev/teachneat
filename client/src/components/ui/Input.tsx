import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

const FIELD =
  'w-full rounded-md border border-subtle bg-base px-3 text-primary placeholder:text-secondary ' +
  'focus:border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 ' +
  'focus-visible:outline-accent';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({ label, id, className = '', ...rest }: InputProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm text-secondary">
        {label}
        {rest.required && <span aria-hidden="true"> *</span>}
      </label>
      <input id={fieldId} className={`${FIELD} h-9 ${className}`} {...rest} />
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function Textarea({ label, id, rows = 3, className = '', ...rest }: TextareaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm text-secondary">
        {label}
      </label>
      <textarea id={fieldId} rows={rows} className={`${FIELD} py-2 ${className}`} {...rest} />
    </div>
  );
}
