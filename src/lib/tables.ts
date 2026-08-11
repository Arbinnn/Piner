import { pineColorToRgba } from './color';

/** Pine's `size.*` names in pixels; a raw number passes through. */
const TEXT_SIZE_PX: Record<string, number> = {
  tiny: 8,
  small: 10,
  normal: 12,
  large: 16,
  huge: 22,
};

const CELL_PAD_X = 8;
const CELL_PAD_Y = 5;
const EDGE_MARGIN = 8;

interface TableCell {
  text?: unknown;
  text_color?: unknown;
  text_size?: unknown;
  text_halign?: unknown;
  text_valign?: unknown;
  bgcolor?: unknown;
}

function cellFontSize(cell: TableCell): number {
  const raw = cell.text_size;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw in TEXT_SIZE_PX) return TEXT_SIZE_PX[raw];
  return TEXT_SIZE_PX.normal;
}

function cellLines(cell: TableCell): string[] {
  return typeof cell.text === 'string' && cell.text.length > 0 ? cell.text.split('\n') : [''];
}

function setFont(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.font = `${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
}

/**
 * Anchors a table to one of Pine's nine screen positions.
 * Tables are chrome, not chart geometry — they never move with price or time.
 */
function anchor(position: string, tableW: number, tableH: number, paneW: number, paneH: number): { x: number; y: number } {
  const right = paneW - tableW - EDGE_MARGIN;
  const centerX = (paneW - tableW) / 2;
  const bottom = paneH - tableH - EDGE_MARGIN;
  const middleY = (paneH - tableH) / 2;

  const x = position.includes('right') ? right : position.includes('left') ? EDGE_MARGIN : centerX;
  const y = position.includes('bottom') ? bottom : position.includes('top') ? EDGE_MARGIN : middleY;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

/**
 * Draws a Pine `table` — the dashboard/HUD most published indicators put in a corner.
 *
 * Column widths and row heights are measured from the cell text, so the grid sizes itself the
 * way TradingView's does rather than needing fixed dimensions.
 */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  props: Record<string, unknown>,
  paneW: number,
  paneH: number,
): void {
  const columns = typeof props.columns === 'number' ? props.columns : 0;
  const rows = typeof props.rows === 'number' ? props.rows : 0;
  const cells = (props.cells ?? {}) as Record<string, TableCell | undefined>;
  if (columns <= 0 || rows <= 0) return;

  const at = (c: number, r: number): TableCell => cells[`${c},${r}`] ?? {};

  // Measure: column width = widest cell in the column, row height = tallest cell in the row.
  const colW = new Array<number>(columns).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const cell = at(c, r);
      const size = cellFontSize(cell);
      setFont(ctx, size);
      const lines = cellLines(cell);
      let widest = 0;
      for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
      colW[c] = Math.max(colW[c], widest + CELL_PAD_X * 2);
      rowH[r] = Math.max(rowH[r], lines.length * (size + 3) + CELL_PAD_Y * 2);
    }
  }

  const tableW = colW.reduce((a, b) => a + b, 0);
  const tableH = rowH.reduce((a, b) => a + b, 0);
  if (tableW <= 0 || tableH <= 0 || tableW > paneW || tableH > paneH) {
    // A table larger than its pane would cover the chart entirely; skip rather than obscure it.
    if (tableW > paneW || tableH > paneH) return;
  }

  const { x: originX, y: originY } = anchor(
    typeof props.position === 'string' ? props.position : 'top_right',
    tableW,
    tableH,
    paneW,
    paneH,
  );

  if (typeof props.bgcolor === 'string') {
    ctx.fillStyle = pineColorToRgba(props.bgcolor);
    ctx.fillRect(originX, originY, tableW, tableH);
  }

  let y = originY;
  for (let r = 0; r < rows; r += 1) {
    let x = originX;
    for (let c = 0; c < columns; c += 1) {
      const cell = at(c, r);
      const w = colW[c];
      const h = rowH[r];

      if (typeof cell.bgcolor === 'string') {
        ctx.fillStyle = pineColorToRgba(cell.bgcolor);
        ctx.fillRect(x, y, w, h);
      }

      const lines = cellLines(cell);
      if (lines.some((l) => l.length > 0)) {
        const size = cellFontSize(cell);
        setFont(ctx, size);
        ctx.fillStyle = pineColorToRgba(typeof cell.text_color === 'string' ? cell.text_color : '#D1D4DCFF');

        const halign = typeof cell.text_halign === 'string' ? cell.text_halign : 'center';
        ctx.textAlign = halign === 'left' ? 'left' : halign === 'right' ? 'right' : 'center';
        const textX = halign === 'left' ? x + CELL_PAD_X : halign === 'right' ? x + w - CELL_PAD_X : x + w / 2;

        ctx.textBaseline = 'middle';
        const lineH = size + 3;
        const blockTop = y + (h - lines.length * lineH) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, textX, blockTop + lineH * i + lineH / 2);
        });
      }

      const frame = typeof props.border_width === 'number' ? props.border_width : 0;
      if (frame > 0) {
        ctx.strokeStyle = pineColorToRgba(typeof props.border_color === 'string' ? props.border_color : '#00000000');
        ctx.lineWidth = frame;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);
      }

      x += w;
    }
    y += rowH[r];
  }

  const frameWidth = typeof props.frame_width === 'number' ? props.frame_width : 0;
  if (frameWidth > 0) {
    ctx.strokeStyle = pineColorToRgba(typeof props.frame_color === 'string' ? props.frame_color : '#00000000');
    ctx.lineWidth = frameWidth;
    ctx.setLineDash([]);
    ctx.strokeRect(originX, originY, tableW, tableH);
  }
}
