import assert from 'node:assert/strict';
import test from 'node:test';
import { drawTable } from './tables.ts';

interface Rect { x: number; y: number; w: number; h: number; fill: string }

/** Canvas stub: records the filled rects, measures text as 10px per character. */
function stubCtx(rects: Rect[]): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'center',
    textBaseline: 'middle',
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h, fill: String(ctx.fillStyle) }),
    fillText: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

test('a cell `width` is a percentage of the pane, not a text measurement', () => {
  const rects: Rect[] = [];
  const cells: Record<string, unknown> = {};
  for (let i = 0; i < 10; i += 1) cells[`${i},0`] = { text: '', bgcolor: '#FF0000FF', width: 5 };

  drawTable(stubCtx(rects), { position: 'bottom_center', columns: 10, rows: 1, cells }, 1000, 400);

  assert.equal(rects.length, 10);
  // 5% of 1000 each: a 500px bar, contiguous, centred — not 10 text-sized blanks.
  for (const r of rects) assert.equal(r.w, 50);
  assert.equal(rects[0].x, 250);
  assert.equal(rects[9].x, 700);
});

test('a cell with no width still sizes itself from its text', () => {
  const rects: Rect[] = [];
  drawTable(
    stubCtx(rects),
    { position: 'top_right', columns: 1, rows: 1, cells: { '0,0': { text: 'abc', bgcolor: '#00FF00FF' } } },
    1000,
    400,
  );
  assert.equal(rects[0].w, 3 * 10 + 16);
});
