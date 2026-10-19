import { Users, SlidersHorizontal, Palette } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PremiumBadge, PremiumControl } from '../../components/ui/Premium';
import { Skeleton } from '../../components/ui/Skeleton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import type { GroupingMode } from './types';

interface ConfigPanelProps {
  mode: GroupingMode;
  onModeChange: (mode: GroupingMode) => void;
  value: number;
  onValueChange: (value: number) => void;
  onGenerate: () => void;
  hasResult: boolean;
  disabled: boolean;
  onOpenConstraints: () => void;
  onOpenAppearance: () => void;
}

// Group size is 2..10 students; group count is 2..20 groups (API_CONTRACT §Grouping).
const LIMITS: Record<GroupingMode, { min: number; max: number; label: string }> = {
  size: { min: 2, max: 10, label: 'Students per group' },
  count: { min: 2, max: 20, label: 'Number of groups' },
};

export function ConfigPanel({
  mode,
  onModeChange,
  value,
  onValueChange,
  onGenerate,
  hasResult,
  disabled,
  onOpenConstraints,
  onOpenAppearance,
}: ConfigPanelProps) {
  const limit = LIMITS[mode];

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-subtle bg-elevated p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Group by</span>
          <SegmentedControl
            label="Grouping mode"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'size', label: 'Group size' },
              { value: 'count', label: 'Number of groups' },
            ]}
          />
        </div>

        <label className="flex flex-col gap-1 text-sm text-secondary">
          {limit.label}
          <input
            type="number"
            min={limit.min}
            max={limit.max}
            value={value}
            onChange={(e) => onValueChange(Number(e.target.value))}
            className="h-9 w-32 rounded-md border border-subtle bg-base px-3 text-base text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>

        <Button variant="primary" className="ml-auto" onClick={onGenerate} disabled={disabled}>
          <Users size={16} strokeWidth={1.75} aria-hidden="true" />
          {hasResult ? 'Regenerate' : 'Generate groups'}
        </Button>
      </div>

      {/* Both are premium. Random generation itself, and the Scale and
          fullscreen projection controls, stay free — those govern whether the
          projection is readable, which is legibility, not decoration. */}
      <div className="flex flex-wrap gap-2">
        <PremiumControl explanation="Keep-together and keep-apart rules are part of Premium.">
          {({ locked, describedBy }) => (
            <Button
              variant="secondary"
              disabled={locked}
              aria-disabled={locked || undefined}
              aria-describedby={describedBy}
              onClick={onOpenConstraints}
            >
              <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
              Constraints
              <PremiumBadge />
            </Button>
          )}
        </PremiumControl>
        <PremiumControl explanation="Display options for the projected groups are part of Premium.">
          {({ locked, describedBy }) => (
            <Button
              variant="secondary"
              disabled={locked}
              aria-disabled={locked || undefined}
              aria-describedby={describedBy}
              onClick={onOpenAppearance}
            >
              <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
              Display options
              <PremiumBadge />
            </Button>
          )}
        </PremiumControl>
      </div>
    </div>
  );
}

/**
 * Placeholder shown in the ConfigPanel's slot while a class's saved grouping
 * loads, so the mode/target controls never flash their defaults before the
 * saved values arrive. Mirrors the panel's two-row shape to avoid layout shift.
 */
export function ConfigPanelSkeleton() {
  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-lg border border-subtle bg-elevated p-4"
    >
      <span className="sr-only">Loading grouping settings…</span>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-36" />
      </div>
    </div>
  );
}
