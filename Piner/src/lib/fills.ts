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
import type { FillRegion, HLine, PlotSeries } from '@heyphat/piner';
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
    // the script's way of switching it off.
    if (!region.color && !region.colors.some(Boolean)) continue;
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
}
