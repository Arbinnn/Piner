import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { DrawObject } from '@heyphat/piner';
import type { Candle } from '../types/candle';
import { pineColorToRgba } from './color';
import { logicalToX } from './coords';
import { drawTable } from './tables';

/** The canvas target type, taken from the library rather than importing `fancy-canvas` directly. */
type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * An explicit Pine `na`, which piner marks as `{ __na: true }`.
 *
 * This is NOT the same as an absent prop. Omitting `color` means "use the Pine default";
 * passing `color = na` means "do not paint this". Scripts gate optional drawings exactly that
 * way — `color = showSignal ? Up : na` — so collapsing the two makes a switched-off drawing
 * render in the fallback grey instead of disappearing.
 */
function isNa(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { __na?: unknown }).__na === true;
}

/** Shared empty lookup, so a frame with no linefill allocates nothing. */
const EMPTY_LINES: ReadonlyMap<number, Record<string, unknown>> = new Map();

/**
 * A line's two on-screen endpoints, with `extend` already applied. Deliberately says nothing
 * about colour: a `linefill` still paints between two lines whose own colour is `na`, which is
 * how a script offers "show the band but not its edges" as a setting.
 */
function lineEndpoints(
  props: Record<string, unknown>,
  geometry: Geometry,
): { ax: number; ay: number; bx: number; by: number } | null {
  const xloc = str(props.xloc, 'bar_index');
  const extend = str(props.extend, 'none');
  const x1 = geometry.x(props.x1, xloc);
  const x2 = geometry.x(props.x2, xloc);
  const y1 = geometry.y(props.y1);
  const y2 = geometry.y(props.y2);
  if (x1 === null || x2 === null || y1 === null || y2 === null) return null;

  let [ax, ay, bx, by] = [x1, y1, x2, y2];
  const dx = x2 - x1;
  // A near-zero dx is a vertical line; extending it horizontally is meaningless, and the
  // slope would blow up. Pine's own hlines arrive as x2 = x1 + 1ms, so this matters.
  if (Math.abs(dx) > 1e-6) {
    const slope = (y2 - y1) / dx;
    if (extend === 'right' || extend === 'both') {
      bx = geometry.width;
      by = y1 + slope * (bx - x1);
    }
    if (extend === 'left' || extend === 'both') {
      ax = 0;
      ay = y1 + slope * (ax - x1);
    }
  }
  return { ax, ay, bx, by };
}

/**
 * `linefill.new(line1, line2, color)` — the band between two lines, as canvas points.
 *
 * The fill references its lines by id and carries no coordinates of its own, so it is resolved
 * against the line objects in the same frame. Scripts use it for range/channel shading:
 * LuxAlgo's Range Sentiment Profile expresses its whole bull/bear bias as one linefill over the
 * range's top and bottom lines, and undrawn the chart shows the levels with no band at all.
 *
 * ponytail: the quad through both lines' endpoints, exact whenever the two lines span the same
 * x range — what every channel script produces. Two lines with disjoint spans would need their
 * overlap clipped first.
 */
export function linefillPolygon(
  props: Record<string, unknown>,
  lines: ReadonlyMap<number, Record<string, unknown>>,
  geometry: Geometry,
): [number, number][] | null {
  const first = lines.get(num(props.line1) ?? NaN);
  const second = lines.get(num(props.line2) ?? NaN);
  if (!first || !second) return null;

  const a = lineEndpoints(first, geometry);
  const b = lineEndpoints(second, geometry);
  if (!a || !b) return null;

  return [
    [a.ax, a.ay],
    [a.bx, a.by],
    [b.bx, b.by],
    [b.ax, b.ay],
  ];
}

/** Below these box dimensions text is unreadable, so it is dropped rather than smeared. */
const MIN_TEXT_HEIGHT = 8;
const MIN_TEXT_WIDTH = 10;

/** Pine's `size.*` names in pixels; a raw number passes through. */
const TEXT_SIZE_PX: Record<string, number> = {
  tiny: 8,
  small: 10,
  normal: 12,
  large: 16,
  huge: 22,
};

function textSizePx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value in TEXT_SIZE_PX) return TEXT_SIZE_PX[value];
  return 11;
}

/**
 * `label.style_*` values that are a MARKER rather than a text callout. These carry no text —
 * a volume-bubble script sets `text = ""` and varies `size` instead — so they must draw on
 * their own rather than being skipped as an empty label.
 */
const SHAPE_STYLES = new Set([
  'circle',
  'square',
  'diamond',
  'triangleup',
  'triangledown',
  'arrowup',
  'arrowdown',
  'cross',
  'xcross',
  'flag',
]);

/** Marker radius in pixels per Pine `size.*`. Tuning knob: TradingView's bubbles run visibly
 *  larger than text of the same size name, so these are not the `TEXT_SIZE_PX` values. */
const SHAPE_RADIUS_PX: Record<string, number> = {
  tiny: 5,
  small: 10,
  normal: 16,
  large: 24,
  huge: 34,
};

function shapeRadiusPx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value / 2;
  if (typeof value === 'string' && value in SHAPE_RADIUS_PX) return SHAPE_RADIUS_PX[value];
  return SHAPE_RADIUS_PX.normal;
}

function applyLineStyle(ctx: CanvasRenderingContext2D, style: string, width: number): void {
  ctx.lineWidth = width;
  if (style === 'dashed') ctx.setLineDash([width * 4, width * 3]);
  else if (style === 'dotted') ctx.setLineDash([width, width * 2]);
  else ctx.setLineDash([]);
}

/** Resolved pixel geometry for one frame; `null` anywhere means "not placeable, skip". */
interface Geometry {
  x(value: unknown, xloc: string): number | null;
  y(value: unknown): number | null;
  width: number;
}

/**
 * Renders piner's drawing objects (`box.new`, `line.new`, `label.new`) as a
 * lightweight-charts series primitive.
 *
 * These are what most published TradingView indicators actually draw with — a script like
 * LuxAlgo's Order Block Detector emits its entire visual output as boxes and lines while its
 * `plot()` calls are `display.none` and intentionally invisible. Without this the chart looks
 * empty even though the script ran correctly.
 *
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private drawings: readonly DrawObject[] = [];
  private candles: readonly Candle[] = [];
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  // Stable view instances: the library caches on array identity, so these are created once.
  // Tables sit on 'top' — they are screen-anchored chrome and must float over everything.
  private readonly views: readonly IPrimitivePaneView[] = [
    // Linefills first: they are the backdrop for the very lines that define them, so they must
    // not paint over a box or a line that happens to have been created earlier.
    this.makeView('bottom', (d) => d.type === 'linefill'),
    this.makeView('bottom', (d) => d.type === 'box'),
    this.makeView('normal', (d) => d.type === 'line' || d.type === 'label' || d.type === 'polyline'),
    this.makeView('top', (d) => d.type === 'table'),
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setData(drawings: readonly DrawObject[], candles: readonly Candle[]): void {
    this.drawings = drawings;
    this.candles = candles;
    this.requestUpdate?.();
  }

  private makeView(zOrder: PrimitivePaneViewZOrder, accept: (d: DrawObject) => boolean): IPrimitivePaneView {
    return {
      zOrder: () => zOrder,
      renderer: (): IPrimitivePaneRenderer | null => {
        const items = this.drawings.filter(accept);
        if (items.length === 0) return null;
        return { draw: (target: RenderTarget) => this.drawItems(target, items) };
      },
    };
  }

  private drawItems(target: RenderTarget, items: readonly DrawObject[]): void {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return;

    target.useMediaCoordinateSpace((scope) => {
      const geometry: Geometry = {
        x: (value, xloc) => {
          const raw = num(value);
          if (raw === null) return null;
          const logical = xloc === 'bar_index' ? raw : this.timeToLogical(raw);
          const x = logicalToX(chart.timeScale(), logical);
          return Number.isFinite(x) ? x : null;
        },
        y: (value) => {
          const price = num(value);
          return price === null ? null : series.priceToCoordinate(price);
        },
        width: scope.mediaSize.width,
      };

      // A linefill carries only the ids of the two lines it spans, so those have to be resolved
      // against the whole frame — not just the items in this view, which never include lines.
      const lines = items.some((d) => d.type === 'linefill') ? this.lineIndex() : EMPTY_LINES;

      const ctx = scope.context;
      for (const item of items) {
        ctx.save();
        if (item.type === 'table') {
          drawTable(ctx, item.props, scope.mediaSize.width, scope.mediaSize.height);
        } else {
          this.drawOne(ctx, item, geometry, lines);
        }
        ctx.restore();
      }
    });
  }

  /** `line.new` objects by id, for the linefills that reference them. */
  private lineIndex(): ReadonlyMap<number, Record<string, unknown>> {
    const lines = new Map<number, Record<string, unknown>>();
    for (const d of this.drawings) if (d.type === 'line') lines.set(d.id, d.props);
    return lines;
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    item: DrawObject,
    geometry: Geometry,
    lines: ReadonlyMap<number, Record<string, unknown>>,
  ): void {
    switch (item.type) {
      case 'box':
        this.drawBox(ctx, item.props, geometry);
        break;
      case 'line':
        this.drawLine(ctx, item.props, geometry);
        break;
      case 'linefill':
        this.drawLinefill(ctx, item.props, geometry, lines);
        break;
      case 'label':
        this.drawLabel(ctx, item.props, geometry);
        break;
      case 'polyline':
        this.drawPolyline(ctx, item.props, geometry);
        break;
      default:
        break;
    }
  }

  private drawBox(ctx: CanvasRenderingContext2D, props: Record<string, unknown>, geometry: Geometry): void {
    const xloc = str(props.xloc, 'bar_index');
    const extend = str(props.extend, 'none');
    const top = geometry.y(props.top);
    const bottom = geometry.y(props.bottom);
    let left = geometry.x(props.left, xloc);
    let right = geometry.x(props.right, xloc);
    if (top === null || bottom === null || left === null || right === null) return;

    if (extend === 'right' || extend === 'both') right = geometry.width;
    if (extend === 'left' || extend === 'both') left = 0;
    if (right < left) [left, right] = [right, left];

    const y = Math.min(top, bottom);
    const height = Math.abs(bottom - top);
    const width = right - left;

    const bg = props.bgcolor;
    if (typeof bg === 'string') {
      ctx.fillStyle = pineColorToRgba(bg);
      ctx.fillRect(left, y, width, height);
    }

    const border = props.border_color;
    const borderWidth = num(props.border_width) ?? 1;
    if (typeof border === 'string' && borderWidth > 0) {
      ctx.strokeStyle = pineColorToRgba(border);
      applyLineStyle(ctx, str(props.border_style, 'solid'), borderWidth);
      ctx.strokeRect(left, y, width, height);
    }

    this.drawBoxText(ctx, props, left, y, width, height);
  }

  /**
   * Box labels — volume-profile scripts put their whole readout here (bin counts, deltas,
   * percentages), so a box renderer without text draws an unreadable stack of bars.
   * Clipped to the box, and skipped when the box is too small to hold legible text, which is
   * what TradingView does rather than letting labels smear over each other.
   */
  private drawBoxText(
    ctx: CanvasRenderingContext2D,
    props: Record<string, unknown>,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    const text = typeof props.text === 'string' ? props.text : '';
    if (text.length === 0) return;
    if (height < MIN_TEXT_HEIGHT || width < MIN_TEXT_WIDTH) return;

    const fontSize = textSizePx(props.text_size);
    if (height < fontSize) return;

    const halign = str(props.text_halign, 'center');
    const valign = str(props.text_valign, 'center');
    const pad = 3;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = pineColorToRgba(typeof props.text_color === 'string' ? props.text_color : '#D1D4DCFF');

    ctx.textAlign = halign === 'left' ? 'left' : halign === 'right' ? 'right' : 'center';
    const x = halign === 'left' ? left + pad : halign === 'right' ? left + width - pad : left + width / 2;

    ctx.textBaseline = valign === 'top' ? 'top' : valign === 'bottom' ? 'bottom' : 'middle';
    const y = valign === 'top' ? top + pad : valign === 'bottom' ? top + height - pad : top + height / 2;

    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawLinefill(
    ctx: CanvasRenderingContext2D,
    props: Record<string, unknown>,
    geometry: Geometry,
    lines: ReadonlyMap<number, Record<string, unknown>>,
  ): void {
    if (isNa(props.color)) return;
    const quad = linefillPolygon(props, lines, geometry);
    if (!quad) return;

    ctx.fillStyle = pineColorToRgba(typeof props.color === 'string' ? props.color : null);
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (const [x, y] of quad.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawLine(ctx: CanvasRenderingContext2D, props: Record<string, unknown>, geometry: Geometry): void {
    if (isNa(props.color)) return;
    const ends = lineEndpoints(props, geometry);
    if (!ends) return;
    const { ax, ay, bx, by } = ends;

    ctx.strokeStyle = pineColorToRgba(typeof props.color === 'string' ? props.color : null);
    applyLineStyle(ctx, str(props.style, 'solid'), num(props.width) ?? 1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  /**
   * `polyline.new` — a run of chart points stroked as one path. Anchored-VWAP and
   * swing-structure scripts emit their entire line this way rather than with `plot()`,
   * because the line has to be drawn backwards from a pivot the script only discovers later.
   *
   * Points arrive as `{ index, time, price }` (see `chart.point.from_index` / `from_time`);
   * `xloc` decides which of the two x fields is live, and the other is `NaN`.
   */
  private drawPolyline(ctx: CanvasRenderingContext2D, props: Record<string, unknown>, geometry: Geometry): void {
    const raw = props.points;
    if (!Array.isArray(raw)) return;

    const xloc = str(props.xloc, 'bar_index');
    const pts: Array<readonly [number, number]> = [];
    for (const point of raw) {
      if (point === null || typeof point !== 'object') continue;
      const p = point as Record<string, unknown>;
      const x = geometry.x(xloc === 'bar_index' ? p.index : p.time, xloc);
      const y = geometry.y(p.price);
      // A single unplaceable point (na price, off-scale bar) is skipped rather than
      // truncating the path — Pine scripts routinely push na into a polyline's warm-up.
      if (x === null || y === null) continue;
      pts.push([x, y]);
    }
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (props.curved === true) {
      // Midpoint quadratic smoothing: each interior point becomes a control point.
      // ponytail: not TradingView's exact spline, but visually indistinguishable at
      // one-point-per-bar density, which is how every real script uses `curved`.
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    } else {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    }
    if (props.closed === true) ctx.closePath();

    const fill = props.fill_color;
    if (typeof fill === 'string') {
      ctx.fillStyle = pineColorToRgba(fill);
      ctx.fill();
    }

    const width = num(props.line_width) ?? 1;
    if (width > 0 && !isNa(props.line_color)) {
      ctx.strokeStyle = pineColorToRgba(typeof props.line_color === 'string' ? props.line_color : null);
      applyLineStyle(ctx, str(props.line_style, 'solid'), width);
      ctx.stroke();
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, props: Record<string, unknown>, geometry: Geometry): void {
    const x = geometry.x(props.x, str(props.xloc, 'bar_index'));
    const y = geometry.y(props.y);
    if (x === null || y === null) return;

    const style = str(props.style, 'label_down');
    if (SHAPE_STYLES.has(style)) {
      this.drawLabelShape(ctx, style, props, x, y);
      return;
    }

    const text = typeof props.text === 'string' ? props.text : '';
    if (text.length === 0 || isNa(props.textcolor)) return;

    const fontSize = textSizePx(props.size);
    ctx.font = `${fontSize}px system-ui, sans-serif`;

    const padding = 4;
    const gap = 6;
    const boxWidth = ctx.measureText(text).width + padding * 2;
    const boxHeight = fontSize + padding * 2;

    // The style names where the POINTER sits, so the body goes the opposite way: `label_left`
    // points left and its body extends right. Anything with neither hint is centred on the anchor.
    const boxX = style.includes('left')
      ? x + gap
      : style.includes('right')
        ? x - gap - boxWidth
        : x - boxWidth / 2;
    const boxY = style.includes('up')
      ? y + gap
      : style.includes('down')
        ? y - gap - boxHeight
        : y - boxHeight / 2;

    if (typeof props.color === 'string') {
      ctx.fillStyle = pineColorToRgba(props.color);
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    }
    ctx.fillStyle = pineColorToRgba(typeof props.textcolor === 'string' ? props.textcolor : '#D1D4DCFF');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, boxX + boxWidth / 2, boxY + boxHeight / 2);
  }

  /** A marker-style label: filled shape centred on the anchor, sized by Pine's `size.*`. */
  private drawLabelShape(
    ctx: CanvasRenderingContext2D,
    style: string,
    props: Record<string, unknown>,
    x: number,
    y: number,
  ): void {
    if (isNa(props.color)) return;

    const r = shapeRadiusPx(props.size);
    ctx.fillStyle = pineColorToRgba(typeof props.color === 'string' ? props.color : null);
    ctx.beginPath();

    switch (style) {
      case 'circle':
        ctx.arc(x, y, r, 0, Math.PI * 2);
        break;
      case 'diamond':
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        break;
      case 'triangleup':
      case 'arrowup':
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.lineTo(x - r, y + r);
        break;
      case 'triangledown':
      case 'arrowdown':
        ctx.moveTo(x, y + r);
        ctx.lineTo(x + r, y - r);
        ctx.lineTo(x - r, y - r);
        break;
      default:
        // square / cross / xcross / flag — a filled square is wrong in detail but visible,
        // which beats the silent drop these used to get.
        ctx.rect(x - r, y - r, r * 2, r * 2);
        break;
    }

    ctx.closePath();
    ctx.fill();
  }

  private timeToLogical(timeMs: number): number {
    return timeToLogical(this.candles, timeMs);
  }
}

/**
 * Maps an epoch-millisecond Pine x-coordinate onto the chart's logical (bar) axis.
 * Interpolates between bars and extrapolates past either end using the adjacent bar
 * spacing, so times that fall between bars — or beyond the last one — still place.
 */
export function timeToLogical(candles: readonly Candle[], timeMs: number): number {
  if (candles.length === 0) return NaN;

  const t = timeMs / 1000;
  const last = candles.length - 1;

  if (t <= candles[0].time) {
    const spacing = candles.length > 1 ? candles[1].time - candles[0].time : 1;
    return spacing > 0 ? (t - candles[0].time) / spacing : 0;
  }
  if (t >= candles[last].time) {
    const spacing = candles.length > 1 ? candles[last].time - candles[last - 1].time : 1;
    return spacing > 0 ? last + (t - candles[last].time) / spacing : last;
  }

  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const span = candles[hi].time - candles[lo].time;
  return span > 0 ? lo + (t - candles[lo].time) / span : lo;
}

/** Every x-bearing prop, so the extent scan doesn't have to know each drawing's shape. */
const X_PROPS = ['left', 'right', 'x', 'x1', 'x2'] as const;

/** Every price-bearing prop, same idea for the vertical extent. */
const Y_PROPS = ['top', 'bottom', 'y', 'y1', 'y2'] as const;

/**
 * The price range the drawings occupy, or `null` if none of them carry a price.
 *
 * A pane that holds ONLY drawings — a gauge or dial built from polylines, with no `plot()`
 * anywhere — has nothing to give its price scale a range, and every drawing then fails to
 * place. The host series is seeded from this instead.
 */
export function drawingsPriceExtent(drawings: readonly DrawObject[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;

  const consider = (value: unknown): void => {
    const price = num(value);
    if (price === null) return;
    if (price < min) min = price;
    if (price > max) max = price;
  };

  for (const d of drawings) {
    for (const prop of Y_PROPS) consider(d.props[prop]);

    const points = d.props.points;
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (point === null || typeof point !== 'object') continue;
      consider((point as Record<string, unknown>).price);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/**
 * The right-most bar index the drawings occupy. Profile-style scripts deliberately draw
 * tens of bars past the last candle, which would otherwise sit outside the default view.
 */
export function drawingsRightExtent(drawings: readonly DrawObject[], candles: readonly Candle[]): number | null {
  let max: number | null = null;
  const consider = (raw: number | null, xloc: string): void => {
    if (raw === null) return;
    const logical = xloc === 'bar_index' ? raw : timeToLogical(candles, raw);
    if (!Number.isFinite(logical)) return;
    if (max === null || logical > max) max = logical;
  };

  for (const d of drawings) {
    const xloc = str(d.props.xloc, 'bar_index');
    for (const prop of X_PROPS) consider(num(d.props[prop]), xloc);

    // Polylines carry their x inside `points`, so the flat prop scan above misses them.
    const points = d.props.points;
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (point === null || typeof point !== 'object') continue;
      const p = point as Record<string, unknown>;
      consider(num(xloc === 'bar_index' ? p.index : p.time), xloc);
    }
  }
  return max;
}
