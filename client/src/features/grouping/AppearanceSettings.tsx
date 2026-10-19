import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import {
  FONTS,
  HEADER_COLORS,
  RAINBOW_KEY,
  RAINBOW_GRADIENT,
  type AppearanceSettings as Settings,
  type FontChoice,
} from './appearance';

interface AppearanceSettingsProps {
  appearance: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function AppearanceSettings({ appearance, onChange, onClose }: AppearanceSettingsProps) {
  return (
    <Modal title="Display options" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <section className="mb-5">
        <h3 className="mb-2 text-md font-medium text-primary">Font</h3>
        <div role="group" aria-label="Font" className="flex flex-wrap gap-2">
          {(Object.keys(FONTS) as FontChoice[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={appearance.font === key}
              onClick={() => onChange({ font: key })}
              style={{ fontFamily: FONTS[key].stack }}
              className={
                'h-9 rounded-md border px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
                (appearance.font === key
                  ? 'border-accent bg-accent-muted text-primary'
                  : 'border-subtle bg-elevated text-secondary hover:bg-hover')
              }
            >
              {FONTS[key].label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-md font-medium text-primary">Group header colour</h3>
        <div role="group" aria-label="Group header colour" className="flex flex-wrap gap-2">
          {HEADER_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={c.label}
              aria-pressed={appearance.headerColorKey === c.key}
              onClick={() => onChange({ headerColorKey: c.key })}
              className={
                'h-9 w-9 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
                (appearance.headerColorKey === c.key
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated'
                  : '')
              }
              style={{ backgroundColor: c.bg }}
            />
          ))}
          <button
            type="button"
            aria-label="Rainbow"
            aria-pressed={appearance.headerColorKey === RAINBOW_KEY}
            onClick={() => onChange({ headerColorKey: RAINBOW_KEY })}
            className={
              'h-9 w-9 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
              (appearance.headerColorKey === RAINBOW_KEY
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated'
                : '')
            }
            style={{ background: RAINBOW_GRADIENT }}
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-md font-medium text-primary">Mark group leader</h3>
            <p className="text-sm text-secondary">
              Star the first member of each group as its leader.
            </p>
          </div>
          <Toggle
            checked={appearance.leaderStar}
            onChange={(v) => onChange({ leaderStar: v })}
            label="Mark group leader"
          />
        </div>
      </section>
    </Modal>
  );
}
