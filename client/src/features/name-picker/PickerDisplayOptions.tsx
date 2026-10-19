import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { PICKER_FONTS, type PickerFont } from './fonts';
import { WHEEL_SCHEMES, schemeGradient } from './palette';
import { CARD_BACKS, cardBackClass } from './cardBacks';
import type { PickerMode, PickerPrefs } from './preferences';

interface PickerDisplayOptionsProps {
  mode: PickerMode;
  prefs: PickerPrefs;
  onChange: (patch: Partial<PickerPrefs>) => void;
  onClose: () => void;
}

const SWATCH_SELECTED = 'ring-2 ring-primary ring-offset-2 ring-offset-elevated';
const SWATCH_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function PickerDisplayOptions({ mode, prefs, onChange, onClose }: PickerDisplayOptionsProps) {
  // Font is stored separately per mode; edit whichever mode is showing.
  const currentFont = mode === 'wheel' ? prefs.wheelFont : prefs.cardFont;
  const setFont = (key: PickerFont) =>
    onChange(mode === 'wheel' ? { wheelFont: key } : { cardFont: key });

  return (
    <Modal title="Display options" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <section className="mb-5">
        <h3 className="mb-2 text-md font-medium text-primary">Font</h3>
        <div role="group" aria-label="Font" className="flex flex-wrap gap-2">
          {(Object.keys(PICKER_FONTS) as PickerFont[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={currentFont === key}
              onClick={() => setFont(key)}
              style={{ fontFamily: PICKER_FONTS[key].stack }}
              className={
                'h-9 rounded-md border px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
                (currentFont === key
                  ? 'border-accent bg-accent-muted text-primary'
                  : 'border-subtle bg-elevated text-secondary hover:bg-hover')
              }
            >
              {PICKER_FONTS[key].label}
            </button>
          ))}
        </div>
      </section>

      {mode === 'wheel' ? (
        <section>
          <h3 className="mb-2 text-md font-medium text-primary">Wheel colours</h3>
          <div role="group" aria-label="Wheel colours" className="flex flex-wrap gap-2">
            {WHEEL_SCHEMES.map((scheme) => (
              <button
                key={scheme.key}
                type="button"
                aria-label={scheme.label}
                aria-pressed={prefs.wheelScheme === scheme.key}
                onClick={() => onChange({ wheelScheme: scheme.key })}
                className={
                  'h-9 w-9 rounded-full ' +
                  SWATCH_FOCUS +
                  ' ' +
                  (prefs.wheelScheme === scheme.key ? SWATCH_SELECTED : '')
                }
                style={{ background: schemeGradient(scheme) }}
              />
            ))}
          </div>
        </section>
      ) : (
        <section>
          <h3 className="mb-2 text-md font-medium text-primary">Card back</h3>
          <div role="group" aria-label="Card back" className="flex flex-wrap gap-3">
            {CARD_BACKS.map((back) => (
              <button
                key={back.key}
                type="button"
                aria-label={back.label}
                aria-pressed={prefs.cardBack === back.key}
                onClick={() => onChange({ cardBack: back.key })}
                className={
                  'rounded-md ' + SWATCH_FOCUS + ' ' + (prefs.cardBack === back.key ? SWATCH_SELECTED : '')
                }
              >
                <span
                  className={'block ttk-deck-card ttk-deck-back ' + cardBackClass(back.key)}
                  style={{
                    position: 'static',
                    width: '2.75rem',
                    height: '3.85rem',
                    // Smaller border on the mini preview than on the full card.
                    ['--ttk-deck-border' as string]: '3px',
                  }}
                />
              </button>
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}
