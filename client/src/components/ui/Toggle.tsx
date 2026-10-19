interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Accessible on/off switch. The accent fill marks the "on" state (large element, per accent rules). */
export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-100 ' +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        (checked ? 'bg-accent' : 'bg-strong')
      }
    >
      <span
        aria-hidden="true"
        className={
          'inline-block h-5 w-5 transform rounded-full bg-base transition-transform duration-100 ' +
          (checked ? 'translate-x-[18px]' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
