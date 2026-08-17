import assert from 'node:assert/strict';
import test from 'node:test';
import { linefillPolygon } from './drawings.ts';

/** Identity geometry: bar index is x, price is y, so the expected quad is readable by eye. */
const geometry = {
  x: (value: unknown): number | null => (typeof value === 'number' ? value : null),
  y: (value: unknown): number | null => (typeof value === 'number' ? value : null),
  width: 1000,
};

const top = { x1: 10, y1: 100, x2: 50, y2: 100 };
const bottom = { x1: 10, y1: 20, x2: 50, y2: 20 };
const lines = new Map<number, Record<string, unknown>>([
  [1, top],
  [2, bottom],
]);

test('a linefill spans both lines, walking one forwards and the other back', () => {
  const quad = linefillPolygon({ line1: 1, line2: 2 }, lines, geometry);
  assert.deepEqual(quad, [
    [10, 100],
    [50, 100],
    [50, 20],
    [10, 20],
  ]);
});

test('a line whose own colour is na still bounds the fill', () => {
  // `showRange = false` sets the edge lines to `color = na` while the band stays visible.
  const hidden = new Map(lines).set(1, { ...top, color: { __na: true } });
  assert.ok(linefillPolygon({ line1: 1, line2: 2 }, hidden, geometry));
});

test('`extend` on a bounding line carries into the fill', () => {
  const extended = new Map(lines).set(1, { ...top, extend: 'right' });
  const quad = linefillPolygon({ line1: 1, line2: 2 }, extended, geometry)!;
  assert.deepEqual(quad[1], [geometry.width, 100]);
});

test('an unresolvable or unplaceable line draws nothing', () => {
  assert.equal(linefillPolygon({ line1: 1, line2: 99 }, lines, geometry), null);
  const naY = new Map(lines).set(2, { ...bottom, y1: null });
  assert.equal(linefillPolygon({ line1: 1, line2: 2 }, naY, geometry), null);
});
