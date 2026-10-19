import { describe, it, expect } from 'vitest';
import { segmentCenterAngle, nextRotation, POINTER_ANGLE } from './wheelGeometry';

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

describe('wheel geometry', () => {
  it('places segment centers evenly around the circle', () => {
    // Four segments: centers at 45, 135, 225, 315 degrees clockwise from top.
    expect(segmentCenterAngle(0, 4)).toBe(45);
    expect(segmentCenterAngle(1, 4)).toBe(135);
    expect(segmentCenterAngle(3, 4)).toBe(315);
  });

  it('lands the chosen segment under the pointer (right, 90°) from any starting rotation', () => {
    const count = 5;
    for (const prev of [0, 37, 400, -90]) {
      for (let index = 0; index < count; index++) {
        const rotation = nextRotation(prev, index, count, 6);
        const resting = mod(segmentCenterAngle(index, count) + rotation, 360);
        expect(resting).toBeCloseTo(POINTER_ANGLE, 6);
      }
    }
  });

  it('always spins forward by at least the requested whole turns', () => {
    const prev = 123;
    const rotation = nextRotation(prev, 3, 8, 6);
    expect(rotation - prev).toBeGreaterThanOrEqual(6 * 360);
    expect(rotation - prev).toBeLessThan(7 * 360);
  });

  it('lands the pointer off-center by the within-segment offset, still inside the segment', () => {
    const count = 6;
    const half = 180 / count; // 30° half-width
    for (const offset of [-25, -10, 0, 12, 27]) {
      const rotation = nextRotation(0, 2, count, 6, POINTER_ANGLE, offset);
      // The pointer now sits at (center + offset), not the center.
      const restingAtPointer = mod(segmentCenterAngle(2, count) + offset + rotation, 360);
      expect(restingAtPointer).toBeCloseTo(POINTER_ANGLE, 6);
      // ...and that offset stays inside the wedge.
      expect(Math.abs(offset)).toBeLessThan(half);
    }
  });
});
