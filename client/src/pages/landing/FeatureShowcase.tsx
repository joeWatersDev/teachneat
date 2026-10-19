import { useRef, useState, type ReactNode } from 'react';
import { CalendarCheck, Group, Mail, Shuffle, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PUBLIC_BILLING_VISIBLE } from '../../config/publicBilling';
import {
  AttendanceShot,
  EmailShot,
  GroupingShot,
  PickerShot,
  StudentsShot,
} from './ProductShots';

/**
 * The landing page's feature section: a vertical rail of tools, and a panel
 * showing the selected one.
 *
 * A tab list rather than a carousel or an accordion, because five items with a
 * one-line description each read as a scannable list before anything is
 * clicked, so the section still communicates with zero interaction. It collapses
 * to a stacked list above the panel on narrow viewports.
 *
 * No star sits on any tool name, and since Step 8a there is no premium part to
 * mark: every tool is included with every account. The note that used to say so
 * under the section is gated with the rest of the cost copy
 * (`PUBLIC_BILLING_VISIBLE`), because stating that nothing is withheld invites
 * the reader to look for what might be.
 */

interface Feature {
  id: string;
  icon: LucideIcon;
  name: string;
  description: string;
  panel: ReactNode;
}

const FEATURES: Feature[] = [
  {
    id: 'students',
    icon: Users,
    name: 'Student Details',
    description: 'Names, contacts, notes and communication history, one click away.',
    panel: <StudentsShot />,
  },
  {
    id: 'attendance',
    icon: CalendarCheck,
    name: 'Attendance',
    description: 'Take the roll in seconds, and see who is slipping before it becomes a problem.',
    panel: <AttendanceShot />,
  },
  {
    id: 'grouping',
    // The sidebar's grouping icon, so the showcase tab and the hero's rail name
    // the same tool with the same mark.
    icon: Group,
    name: 'Grouping',
    description: 'Fresh groups in one click, with the pairings you need kept together or apart.',
    panel: <GroupingShot />,
  },
  {
    id: 'picker',
    icon: Shuffle,
    name: 'Name Picker',
    description: 'Call on students at random with fun visual displays.',
    panel: <PickerShot />,
  },
  {
    id: 'email',
    icon: Mail,
    name: 'Class Email',
    description:
      'Choose exactly who hears from you, with messages personalized for each student and family.',
    panel: <EmailShot />,
  },
];

export function FeatureShowcase() {
  const [active, setActive] = useState(FEATURES[0].id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * Arrow keys move between tabs and take focus with them, which is what the
   * tab pattern requires; only the selected tab is in the tab order.
   */
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = FEATURES.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    const id = FEATURES[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
      {/* Cut down to the heading alone. The section had a heading and a subhead
          saying the same thing at two sizes, and the tab list below names the
          tools anyway, so the claim was being read three times. Both sentences
          now carry heading weight, and the break is pinned to the sentence
          boundary at every width. It was briefly suppressed below sm, on the
          reasoning that the second sentence wraps on its own down there and the
          forced break only adds a third line; that is still true, and the break
          stays anyway, because one sentence per line is the point and a heading
          that regroups itself on a phone reads as a different heading.
          text-balance is off: the explicit break is the balance, and leaving
          both on lets the browser re-split the halves.

          No max-width here, deliberately. The wrapper this replaces carried
          max-w-[58ch], sized for the paragraph that used to sit under the
          heading: ch resolves against the wrapper's inherited 16px, giving
          about 464px, while the heading renders at up to 32px and needs about
          510px for the second sentence. That clipped one word onto a third
          line. The line lengths are set by the break, so the section's own
          max-w-5xl is the only bound needed. */}
      <h2 className="text-display-md font-semibold text-primary">
        Enter your class list once.
        <br /> All tools read from the same list.
      </h2>

      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[300px_1fr]">
        <div role="tablist" aria-orientation="vertical" aria-label="Features" className="flex flex-col gap-1.5">
          {FEATURES.map((f, i) => {
            const selected = f.id === active;
            return (
              <button
                key={f.id}
                ref={(el) => {
                  tabRefs.current[f.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${f.id}`}
                aria-selected={selected}
                aria-controls={`panel-${f.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(f.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={
                  'flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors duration-100 ' +
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
                  (selected
                    ? 'border-subtle bg-elevated'
                    : 'border-transparent hover:bg-hover')
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg border ' +
                    (selected
                      ? 'border-transparent bg-accent-muted text-primary'
                      : 'border-subtle bg-surface text-secondary')
                  }
                >
                  <f.icon size={17} strokeWidth={1.8} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-primary">{f.name}</span>
                  <span className="text-sm text-secondary">{f.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-subtle bg-base">
          {FEATURES.map((f) => (
            <div
              key={f.id}
              role="tabpanel"
              id={`panel-${f.id}`}
              aria-labelledby={`tab-${f.id}`}
              hidden={f.id !== active}
            >
              {f.panel}
            </div>
          ))}
        </div>
      </div>

      {PUBLIC_BILLING_VISIBLE && (
        <p className="mx-auto mt-5 flex max-w-[72ch] flex-wrap items-start justify-center gap-2 text-center text-sm text-secondary">
          Every tool above is included with every account, at no cost while Teachneat is in early
          access.{' '}
          <Link to="/pricing" className="text-primary underline hover:no-underline">
            What that means
          </Link>
        </p>
      )}
    </section>
  );
}
