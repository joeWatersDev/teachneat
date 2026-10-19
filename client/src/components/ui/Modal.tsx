import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 'content' = 560px, 'confirm' = 400px (DESIGN_SYSTEM modal sizes). */
  size?: 'content' | 'confirm';
}

export function Modal({ title, onClose, children, footer, size = 'content' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus on mount, and only on mount. This used to sit in the effect above,
  // where it re-ran whenever `onClose` changed identity — which, for a caller
  // that passes an inline arrow and re-renders on every keystroke, is every
  // keystroke. The panel then stole focus back from whatever field was being
  // typed into and only the first character landed. Callers whose modal content
  // holds its own state never saw it, because their parent did not re-render;
  // it appeared the moment a modal's text field and its `onClose` lived in the
  // same component. Focusing the panel is a mount concern, so it belongs in a
  // mount-only effect rather than in one keyed on a handler.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          // Cap the panel to the viewport height (minus the overlay's p-4) and let
          // the body scroll, so a tall form still fits on a short screen (iPhone SE).
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl bg-elevated outline-none ' +
          (size === 'confirm' ? 'max-w-[400px]' : 'max-w-[560px]')
        }
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div className={'min-h-0 overflow-y-auto px-6' + (footer ? '' : ' pb-6')}>{children}</div>
        {footer && (
          // Wraps, because buttons carry `whitespace-nowrap` and so cannot
          // shrink: a footer with one action too many for the panel width
          // pushed its buttons out through the side rather than overflowing
          // visibly enough to look deliberate. Wrapping engages only when the
          // row would not otherwise fit, so a two-button footer is unchanged.
          <div className="flex shrink-0 flex-wrap justify-end gap-2 px-6 pb-6 pt-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
