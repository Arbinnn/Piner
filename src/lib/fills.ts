import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { FillGradient, FillRegion, HLine, PlotSeries } from '@heyphat/piner';
import { pineColorToRgba } from './color';
import { logicalToX } from './coords';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** One fill with its two boundary series already resolved to data arrays. */
export interface ResolvedFill {
  region: FillRegion;
  top: readonly number[];
  bottom: readonly number[];
}

/**
 * Pairs a `fill()` region with the data it spans.
 *
 * A boundary id may name either a plot or an **hline** — `fill(upperBand, lowerBand)` between
 * two `hline()`s is the standard way to shade an RSI band — so both maps are consulted, and an
 * hline becomes a constant level across every bar.
 */
function hasGradientColor(gradient: FillGradient | undefined): boolean {
  return gradient !== undefined && (gradient.topColor.some(Boolean) || gradient.bottomColor.some(Boolean));
}

/**
 * The two CSS stops for one bar of a gradient, or `null` when the bar has no colour at all.
 *
 * Either end may be `na` — `fill(…, top_color, na)` fading a band out into the chart is the
 * common case. A missing end becomes the OTHER end's RGB at zero alpha rather than a generic
 * transparent: canvas interpolates gradient stops in non-premultiplied sRGB, so fading to
 * `rgba(0,0,0,0)` would drag the midpoint through grey and leave a dirty smear.
 */
function gradientStops(top: string | null | undefined, bottom: string | null | undefined): [string, string] | null {
  if (!top && !bottom) return null;
  return [top ? pineColorToRgba(top) : fadeOut(bottom!), bottom ? pineColorToRgba(bottom) : fadeOut(top!)];
}

/** Same hue, zero alpha. */
function fadeOut(hex: string): string {
  return pineColorToRgba(`${hex.slice(0, 7)}00`);
}

export function resolveFills(
  fills: ReadonlyMap<number, FillRegion>,
  plots: ReadonlyMap<number, PlotSeries>,
  hlines: ReadonlyMap<number, HLine>,
  barCount: number,
): ResolvedFill[] {
  const levelCache = new Map<number, readonly number[]>();
  const boundary = (id: number): readonly number[] | null => {
    const plot = plots.get(id);
    if (plot) return plot.data;
    const hline = hlines.get(id);
    if (!hline) return null;
    let level = levelCache.get(id);
    if (!level) {
      level = new Array<number>(barCount).fill(hline.price);
      levelCache.set(id, level);
    }
    return level;
  };

  const out: ResolvedFill[] = [];
  for (const region of fills.values()) {
    const top = boundary(region.plot1);
    const bottom = boundary(region.plot2);
    if (!top || !bottom) continue;
    // A fill with neither a static colour nor any per-bar colour is `fill(..., color = na)` —
    // the script's way of switching it off. A gradient fill carries its colours in `gradient`
    // and leaves both of those empty, so it has to be checked separately or it is discarded here.
    if (!region.color && !region.colors.some(Boolean) && !hasGradientColor(region.gradient)) continue;
    out.push({ region, top, bottom });
  }
  return out;
}

/**
 * Paints `fill()` regions between two plots.
 *
 * lightweight-charts has no between-series fill, and these are not decoration: gradient-fill
 * indicators stack several translucent `fill()` layers between hidden helper plots, so without
 * this the script's entire shaded body is missing while its line still draws.
 *
 * Boundary plots are read from their DATA, not their series, so fills still work when the
 * bounding plots are `display.none` — which is exactly how such scripts hide their helpers.
 */
export class FillsPrimitive implements ISeriesPrimitive<Time> {
  private fills: readonly ResolvedFill[] = [];
  private barCount = 0;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private readonly views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom',
      renderer: (): IPrimitivePaneRenderer | null =>
        this.fills.length === 0 ? null : { draw: (target: RenderTarget) => this.drawFills(target) },
    },
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

  setData(fills: readonly ResolvedFill[], barCount: number): void {
    this.fills = fills;
    this.barCount = barCount;
    this.requestUpdate?.();
  }

  private drawFills(target: RenderTarget): void {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series || this.barCount === 0) return;

    const timeScale = chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    const from = Math.max(0, Math.floor(visible ? visible.from - 1 : 0));
    const to = Math.min(this.barCount - 1, Math.ceil(visible ? visible.to + 1 : this.barCount - 1));
    if (to < from) return;

    // x is shared by every fill, so resolve it once per frame rather than per region.
    const xs = new Float64Array(to - from + 1);
    for (let i = from; i <= to; i += 1) {
      xs[i - from] = logicalToX(timeScale, i);
    }

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      for (const fill of this.fills) {
        this.drawOne(ctx, fill, xs, from, to, series);
      }
    });
  }

  /**
   * Emits one polygon per run of consecutive bars sharing a colour. Per-bar colours change
   * only when the script's trend flips, so batching keeps this to a handful of paths instead
   * of one quad per bar.
   */
  private drawOne(
    ctx: CanvasRenderingContext2D,
    fill: ResolvedFill,
    xs: Float64Array,
    from: number,
    to: number,
    series: ISeriesApi<SeriesType, Time>,
  ): void {
    const { region, top, bottom } = fill;
    if (region.gradient) {
      this.drawGradient(ctx, fill, region.gradient, xs, from, to, series);
      return;
    }

    let runStart = -1;
    let runColor = '';

    const flush = (endExclusive: number): void => {
      if (runStart < 0 || endExclusive - runStart < 2) {
        runStart = -1;
        return;
      }
      ctx.beginPath();
      for (let i = runStart; i < endExclusive; i += 1) {
        const y = series.priceToCoordinate(top[i]);
        if (y === null) continue;
        if (i === runStart) ctx.moveTo(xs[i - from], y);
        else ctx.lineTo(xs[i - from], y);
      }
      for (let i = endExclusive - 1; i >= runStart; i -= 1) {
        const y = series.priceToCoordinate(bottom[i]);
        if (y === null) continue;
        ctx.lineTo(xs[i - from], y);
      }
      ctx.closePath();
      ctx.fillStyle = pineColorToRgba(runColor);
      ctx.fill();
      runStart = -1;
    };

    for (let i = from; i <= to; i += 1) {
      const color = region.colors[i] ?? region.color;
      const usable = color !== null && color !== undefined && Number.isFinite(top[i]) && Number.isFinite(bottom[i]) && Number.isFinite(xs[i - from]);

      if (!usable) {
        flush(i);
        continue;
      }
      if (runStart < 0) {
        runStart = i;
        runColor = color;
      } else if (color !== runColor) {
        // Close the current run ON this bar so the two polygons meet with no seam.
        flush(i + 1);
        runStart = i;
        runColor = color;
      }
    }
    flush(to + 1);
  }

  /**
   * `fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color)` — a vertical
   * gradient rather than a flat wash.
   *
   * The region is still bounded by the two plots, but the colour ramp is anchored to
   * `top_value`/`bottom_value`, which are independent series and move every bar. That rules
   * out the run-batching the flat path uses: a single linear gradient stretched over a run
   * would stay put while the band slopes away from it. One quad per bar pair instead, each
   * with its own ramp.
   */
  private drawGradient(
    ctx: CanvasRenderingContext2D,
    fill: ResolvedFill,
    gradient: FillGradient,
    xs: Float64Array,
    from: number,
    to: number,
    series: ISeriesApi<SeriesType, Time>,
  ): void {
    const { top, bottom } = fill;
    const y = (price: number | undefined): number | null =>
      typeof price === 'number' && Number.isFinite(price) ? series.priceToCoordinate(price) : null;

    for (let i = from; i < to; i += 1) {
      const stops = gradientStops(gradient.topColor[i], gradient.bottomColor[i]);
      if (!stops) continue;

      const topA = y(top[i]);
      const topB = y(top[i + 1]);
      const botA = y(bottom[i]);
      const botB = y(bottom[i + 1]);
      if (topA === null || topB === null || botA === null || botB === null) continue;

      const xA = xs[i - from];
      const xB = xs[i + 1 - from];
      if (!Number.isFinite(xA) || !Number.isFinite(xB)) continue;

      ctx.beginPath();
      ctx.moveTo(xA, topA);
      // Half a pixel of overlap into the next quad. Adjacent translucent paths that meet
      // exactly leave antialiased hairlines, which read as vertical banding across the fill.
      ctx.lineTo(xB + 0.5, topB);
      ctx.lineTo(xB + 0.5, botB);
      ctx.lineTo(xA, botA);
      ctx.closePath();

      const rampTop = y(gradient.topValue[i]) ?? topA;
      const rampBottom = y(gradient.bottomValue[i]) ?? botA;
      if (Math.abs(rampTop - rampBottom) < 0.5) {
        ctx.fillStyle = stops[0];
      } else {
        const ramp = ctx.createLinearGradient(0, rampTop, 0, rampBottom);
        ramp.addColorStop(0, stops[0]);
        ramp.addColorStop(1, stops[1]);
        ctx.fillStyle = ramp;
      }
      ctx.fill();
    }
  }
}
