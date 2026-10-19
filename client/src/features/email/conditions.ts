/**
 * Client mirror of the server's bounded email-template conditions
 * (server/src/services/emailConditions.ts). Used to (1) offer the metric/
 * operator choices in the editor, (2) format the human label shown on a
 * conditional block, and (3) evaluate conditions in the compose preview so the
 * teacher sees exactly what each recipient will receive.
 *
 * A condition lives in a `data-if` attribute as a space-separated triple:
 *   <numericMetric> gte <0..999>     e.g. "lateCount gte 3"
 *   <booleanMetric> is <true|false>  e.g. "atRisk is true"
 */

export interface ConditionContext {
  lateCount: number;
  unexcusedAbsences: number;
  atRisk: boolean;
}

export interface MetricDef {
  key: string;
  label: string;
  kind: 'numeric' | 'boolean';
  /** For boolean metrics: the human label shown on a block for the true / false case. */
  boolTrue?: string;
  boolFalse?: string;
}

export const CONDITION_METRICS: readonly MetricDef[] = [
  { key: 'lateCount', label: 'Number of lates', kind: 'numeric' },
  { key: 'unexcusedAbsences', label: 'Number of unexcused absences', kind: 'numeric' },
  {
    key: 'atRisk',
    label: 'At academic risk',
    kind: 'boolean',
    boolTrue: 'Only if student is at academic risk',
    boolFalse: 'Only if student is not at academic risk',
  },
];

const METRIC_BY_KEY = new Map(CONDITION_METRICS.map((m) => [m.key, m]));

export interface ParsedCondition {
  metric: string;
  op: 'gte' | 'is';
  value: number | boolean;
}

export function parseCondition(raw: string): ParsedCondition | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [metric, op, val] = parts;
  const def = METRIC_BY_KEY.get(metric);
  if (!def) return null;
  if (def.kind === 'numeric') {
    if (op !== 'gte' || !/^\d{1,3}$/.test(val)) return null;
    return { metric, op: 'gte', value: Number(val) };
  }
  if (op !== 'is' || (val !== 'true' && val !== 'false')) return null;
  return { metric, op: 'is', value: val === 'true' };
}

export function isValidCondition(raw: string): boolean {
  return parseCondition(raw) !== null;
}

/** Serializes an editor selection back into the `data-if` string form. */
export function buildCondition(metric: string, value: number | boolean): string {
  return typeof value === 'boolean'
    ? `${metric} is ${value ? 'true' : 'false'}`
    : `${metric} gte ${value}`;
}

/** Human label for a conditional block, e.g. "Only if lates ≥ 3". */
export function formatCondition(raw: string): string | null {
  const parsed = parseCondition(raw);
  if (!parsed) return null;
  const def = METRIC_BY_KEY.get(parsed.metric);
  if (!def) return null;
  if (parsed.op === 'gte') return `Only if ${def.label.replace(/^Number of /, '')} ≥ ${parsed.value}`;
  return (parsed.value ? def.boolTrue : def.boolFalse) ?? null;
}

export function evaluateCondition(raw: string, ctx: ConditionContext): boolean {
  const parsed = parseCondition(raw);
  if (!parsed) return false;
  if (parsed.op === 'gte') {
    const actual = parsed.metric === 'lateCount' ? ctx.lateCount : ctx.unexcusedAbsences;
    return actual >= (parsed.value as number);
  }
  return ctx.atRisk === (parsed.value as boolean);
}

/** Drops blocks whose condition fails for `ctx` and strips markers from the
 * rest — the body as a specific recipient would receive it. */
export function applyConditions(html: string, ctx: ConditionContext): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('[data-if]').forEach((el) => {
    const cond = el.getAttribute('data-if') ?? '';
    if (!evaluateCondition(cond, ctx)) el.remove();
    else el.removeAttribute('data-if');
  });
  return doc.body.innerHTML;
}

/** Strips all condition markers without evaluating them — used for a design
 * preview that shows every block regardless of condition. */
export function stripConditionAttrs(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('[data-if]').forEach((el) => el.removeAttribute('data-if'));
  return doc.body.innerHTML;
}
