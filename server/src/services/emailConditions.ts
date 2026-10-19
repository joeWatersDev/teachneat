/**
 * Bounded conditions for email template blocks. A condition is a fixed metric,
 * a fixed operator, and one validated literal — never a user-authored
 * expression. This keeps the "logic-less" security posture of the templating:
 * the server owns the comparison, the teacher only supplies a number or a
 * boolean. Conditions live in a `data-if` attribute on block elements
 * (`p`, `ul`, `ol`, `li`) and are evaluated per (student, course) at send time.
 *
 * Grammar (space-separated triple):
 *   <numericMetric> gte <0..999>      e.g. "lateCount gte 3"
 *   <booleanMetric> is <true|false>   e.g. "atRisk is true"
 */

export interface ConditionContext {
  /** Tardies for the (student, course) being sent to. */
  lateCount: number;
  /** Unexcused absences for the (student, course) being sent to. */
  unexcusedAbsences: number;
  /** Whether the student is flagged at academic risk in the (student, course) being sent to. */
  atRisk: boolean;
}

const NUMERIC_METRICS = ['lateCount', 'unexcusedAbsences'] as const;
const BOOLEAN_METRICS = ['atRisk'] as const;

type NumericMetric = (typeof NUMERIC_METRICS)[number];
type BooleanMetric = (typeof BOOLEAN_METRICS)[number];

export interface ParsedCondition {
  metric: NumericMetric | BooleanMetric;
  op: 'gte' | 'is';
  value: number | boolean;
}

function isNumericMetric(m: string): m is NumericMetric {
  return (NUMERIC_METRICS as readonly string[]).includes(m);
}
function isBooleanMetric(m: string): m is BooleanMetric {
  return (BOOLEAN_METRICS as readonly string[]).includes(m);
}

/** Parses a raw `data-if` value, or returns null if it does not match the grammar. */
export function parseCondition(raw: string): ParsedCondition | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [metric, op, val] = parts;
  if (isNumericMetric(metric)) {
    if (op !== 'gte' || !/^\d{1,3}$/.test(val)) return null;
    return { metric, op: 'gte', value: Number(val) };
  }
  if (isBooleanMetric(metric)) {
    if (op !== 'is' || (val !== 'true' && val !== 'false')) return null;
    return { metric, op: 'is', value: val === 'true' };
  }
  return null;
}

export function isValidCondition(raw: string): boolean {
  return parseCondition(raw) !== null;
}

/**
 * Whether a block guarded by `raw` should be included for this context.
 * A malformed condition fails closed (block excluded) — it should never reach
 * here, since conditions are validated when a template is saved.
 */
export function evaluateCondition(raw: string, ctx: ConditionContext): boolean {
  const parsed = parseCondition(raw);
  if (!parsed) return false;
  if (parsed.op === 'gte') {
    const actual = parsed.metric === 'lateCount' ? ctx.lateCount : ctx.unexcusedAbsences;
    return actual >= (parsed.value as number);
  }
  return ctx.atRisk === (parsed.value as boolean);
}
