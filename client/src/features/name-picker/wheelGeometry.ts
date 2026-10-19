/**
 * Pure geometry for the spinning wheel. Angles are measured in degrees clockwise
 * from the top (12 o'clock). The pointer sits at the right (3 o'clock = 90°). Kept
 * separate from the React component so the segment maths and landing rotation are
 * unit-tested.
 */

const CENTER = 150;
const RADIUS = 150;

/** Where the pointer sits, in degrees clockwise from the top. Right side = 90°. */
export const POINTER_ANGLE = 90;

/** A point on the wheel's edge at `angle` degrees clockwise from the top. */
function edgePoint(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.sin(rad),
    y: CENTER - RADIUS * Math.cos(rad),
  };
}

/** SVG path for the pie slice covering `[startAngle, endAngle]` (clockwise). */
export function segmentPath(startAngle: number, endAngle: number): string {
  const start = edgePoint(startAngle);
  const end = edgePoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  // sweep-flag 1 draws the arc clockwise, matching our clockwise angle convention.
  return `M ${CENTER} ${CENTER} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

/** Center angle of segment `index` of `count` equal segments. */
export function segmentCenterAngle(index: number, count: number): number {
  const seg = 360 / count;
  return (index + 0.5) * seg;
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

/**
 * Next absolute clockwise rotation (degrees) for the wheel: spins forward from
 * `prevRotation` by at least `turns` full turns and lands the pointer (at
 * `pointerAngle`, default the right side) somewhere in segment `index`. By default
 * it lands dead-center; `offsetDeg` shifts the landing point within the segment
 * (positive = clockwise of center), which is how the spin lands anywhere across a
 * name's wedge — occasionally near a border for a "close call". Rotation
 * accumulates across draws (it only ever increases) so a repeat winner still spins.
 */
export function nextRotation(
  prevRotation: number,
  index: number,
  count: number,
  turns: number,
  pointerAngle: number = POINTER_ANGLE,
  offsetDeg: number = 0,
): number {
  // Rotation (mod 360) that brings the chosen point (center + offset) to the pointer.
  const targetMod = mod(pointerAngle - (segmentCenterAngle(index, count) + offsetDeg), 360);
  const forward = mod(targetMod - mod(prevRotation, 360), 360);
  return prevRotation + turns * 360 + forward;
}

export { CENTER, RADIUS };
