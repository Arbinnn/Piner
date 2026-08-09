import {
  CandlestickSeries,
  LineSeries,
  LineType,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type WhitespaceData,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import type { CandleSeries, DrawObject, HLine, MarkerSeries, OutputCollector, PlotSeries } from '@heyphat/piner';
import type { Candle } from '../types/candle';
import { pineColorToRgba } from './color';
import { DrawingsPrimitive, drawingsPriceExtent, drawingsRightExtent } from './drawings';
import { FillsPrimitive, resolveFills, type ResolvedFill } from './fills';
import { BackgroundPrimitive } from './backgrounds';

const STEP_STYLES = new Set(['stepline', 'steplinebr', 'stepline_diamond']);

/**
 * Pine's `*br` ("with breaks") styles, where `na` must CUT the line.
 *
 * This is the only thing separating `plot.style_linebr` from `plot.style_line`, and scripts
 * lean on it hard: a two-state indicator plots one series for the bullish regime and another
 * for the bearish, each `na` wherever the other is live. Join those gaps and both lines run
 * the full width of the chart, overlapping, instead of handing off.
 */
const BREAK_ON_NA_STYLES = new Set(['linebr', 'steplinebr', 'areabr']);
const OVERLAY_PANE = 0;
const SEPARATE_PANE = 1;

/**
 * A line series that draws nothing but still participates in the pane (so price lines /
 * markers attached to it render). `visible: false` was tried first and rejected — LWC
 * suppresses a series' price lines and marker primitives along with the series itself, so
 * the host must stay "visible" and merely paint fully transparent.
 */
const HOST_SERIES_OPTIONS = {
  color: 'rgba(0, 0, 0, 0)',
  lineWidth: 1 as const,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
};

/** The price span a plotless pane's host series must cover. */
interface PriceExtent {
  min: number;
  max: number;
}

function sameExtent(a: PriceExtent | undefined, b: PriceExtent): boolean {
  return a !== undefined && a.min === b.min && a.max === b.max;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asLineWidth(value: unknown): 1 | 2 | 3 | 4 {
  const n = Math.round(asNumber(value, 2));
  return n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4;
}

function lineTypeFor(options: Record<string, unknown>): LineType {
  const style = typeof options.style === 'string' ? options.style : '';
  return STEP_STYLES.has(style) ? LineType.WithSteps : LineType.Simple;
}

function isVisible(options: Record<string, unknown>): boolean {
  return options.display !== 'none';
}

/**
 * `force_overlay = true` — Pine v6's per-output escape hatch, putting one plot/fill/drawing on
 * the PRICE pane even though its indicator is `overlay = false`.
 *
 * An oscillator that also marks price-level zones relies on this. Ignore it and those
 * price-scaled outputs land in the oscillator's pane, where they both vanish into a wildly
 * wrong scale and wreck the pane's own autoscale.
 */
function forcesOverlay(options: Record<string, unknown>): boolean {
  return options.force_overlay === true;
}

function seriesLegendColor(colors: readonly (string | null)[]): string {
  for (let i = colors.length - 1; i >= 0; i -= 1) {
    if (colors[i]) return pineColorToRgba(colors[i]);
  }
  return pineColorToRgba(null);
}

function plotPoint(plot: PlotSeries, candles: readonly Candle[], i: number, value: number): LineData<Time> {
  const color = plot.colors[i];
  return color ? { time: candles[i].time, value, color: pineColorToRgba(color) } : { time: candles[i].time, value };
}

/**
 * Splits a plot into the contiguous runs of real values that a `*br` style must draw as
 * SEPARATE lines, so `na` shows as a genuine gap.
 *
 * A whitespace point does not do this. lightweight-charts drops whitespace before it reaches
 * the series (`seriesRows.filter(isSeriesPlotRow)`) — it only widens the time scale — and the
 * line renderer then walks whatever points remain and joins them, drawing a long diagonal
 * straight across the gap. One series per run is what actually breaks the line.
 *
 * ponytail: one LWC series per run. Fine at the tens-of-flips a regime indicator produces;
 * a plot that alternated na every other bar over thousands of bars would want a single
 * canvas primitive stroking the runs instead.
 */
function splitPlotRuns(plot: PlotSeries, candles: readonly Candle[]): LineData<Time>[][] {
  const runs: LineData<Time>[][] = [];
  let current: LineData<Time>[] = [];

  for (let i = 0; i < plot.data.length && i < candles.length; i += 1) {
    const value = plot.data[i];
    if (!Number.isFinite(value)) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(plotPoint(plot, candles, i, value));
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Every real value as one continuous line: `na` is skipped and the gap joins, which is what
 *  the non-`br` Pine styles mean. */
function plotToLineData(plot: PlotSeries, candles: readonly Candle[]): LineData<Time>[] {
  const points: LineData<Time>[] = [];
  for (let i = 0; i < plot.data.length && i < candles.length; i += 1) {
    const value = plot.data[i];
    if (Number.isFinite(value)) points.push(plotPoint(plot, candles, i, value));
  }
  return points;
}

function candlesToWhitespace(candles: readonly Candle[]): WhitespaceData<Time>[] {
  return candles.map((c) => ({ time: c.time }));
}

/**
 * Maps a `plotcandle()` series onto lightweight-charts candlestick data, carrying Pine's
 * per-bar body/wick/border colours. Bars the script left `na` become whitespace, so the
 * series simply has no candle there rather than a zeroed one.
 */
function candleSeriesToData(
  series: CandleSeries,
  candles: readonly Candle[],
): (CandlestickData<Time> | WhitespaceData<Time>)[] {
  const out: (CandlestickData<Time> | WhitespaceData<Time>)[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const ohlc = series.data[i];
    const time = candles[i].time;
    if (!ohlc || ![ohlc.open, ohlc.high, ohlc.low, ohlc.close].every(Number.isFinite)) {
      out.push({ time });
      continue;
    }
    const body = series.colors[i];
    const wick = series.wickColors[i];
    const border = series.borderColors[i];
    out.push({
      time,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
      ...(body ? { color: pineColorToRgba(body) } : {}),
      ...(wick ? { wickColor: pineColorToRgba(wick) } : {}),
      ...(border ? { borderColor: pineColorToRgba(border) } : {}),
    });
  }
  return out;
}

function markerPosition(location: string): 'aboveBar' | 'belowBar' | 'inBar' {
  if (location === 'belowbar' || location === 'bottom') return 'belowBar';
  if (location === 'absolute') return 'inBar';
  return 'aboveBar';
}

/**
 * Pine names ~15 shapes; lightweight-charts offers four. Map onto the nearest, preserving the
 * up/down sense that carries the signal's meaning — a `shape.labelup` buy marker must not end
 * up looking identical to a `shape.labeldown` sell marker.
 */
const MARKER_SHAPES: Record<string, 'circle' | 'square' | 'arrowUp' | 'arrowDown'> = {
  triangleup: 'arrowUp',
  arrowup: 'arrowUp',
  labelup: 'arrowUp',
  flag: 'arrowUp',
  triangledown: 'arrowDown',
  arrowdown: 'arrowDown',
  labeldown: 'arrowDown',
  circle: 'circle',
  square: 'square',
  diamond: 'square',
  xcross: 'square',
  cross: 'square',
};

function markerShape(marker: MarkerSeries, position: string): 'circle' | 'square' | 'arrowUp' | 'arrowDown' {
  const mapped = MARKER_SHAPES[marker.glyph];
  if (mapped) return mapped;
  // Unknown or character glyph: fall back to the direction the location implies.
  return position === 'belowBar' ? 'arrowUp' : 'arrowDown';
}

function markersToSeriesMarkers(marker: MarkerSeries, candles: readonly Candle[]): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  const position = markerPosition(marker.location);
  const shape = markerShape(marker, position);
  for (let i = 0; i < marker.data.length && i < candles.length; i += 1) {
    const point = marker.data[i];
    if (!point) continue;
    // plotchar's glyph IS its visible content, so surface it when no explicit text was given.
    const text = point.text ?? (marker.kind === 'char' ? marker.glyph : undefined);
    out.push({
      time: candles[i].time,
      position,
      shape,
      color: pineColorToRgba(point.color),
      ...(text ? { text } : {}),
    });
  }
  return out;
}

type HostSeries = ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;

interface TrackedPlot {
  kind: 'plot';
  paneIndex: number;
  api: ISeriesApi<'Line'>;
  /** `plot(..., display=display.none)` hides the series — and with it anything attached to it. */
  visible: boolean;
}
interface TrackedHline {
  kind: 'hline';
  paneIndex: number;
  host: HostSeries;
  priceLine: ReturnType<HostSeries['createPriceLine']>;
}
/** A `plotcandle()` / `plotbar()` overlay series. */
interface TrackedCandle {
  kind: 'candle';
  paneIndex: number;
  api: ISeriesApi<'Candlestick'>;
}
/** Shared invisible line series that gives a non-candle pane (e.g. RSI) something to
 *  host a price line (hline) on, since `createPriceLine` needs a series to hang off. */
interface TrackedPaneHost {
  kind: 'panehost';
  paneIndex: number;
  /** Price span this host is currently seeded to cover; undefined while it is whitespace-only. */
  extent?: PriceExtent;
  api: ISeriesApi<'Line'>;
}
type Tracked = TrackedPlot | TrackedHline | TrackedPaneHost | TrackedCandle;

/**
 * Draws piner's `OutputCollector` onto a lightweight-charts instance, reconciling
 * against what is already drawn instead of tearing down and rebuilding — this is what
 * makes an input-driven re-run feel instant and keeps repeated Run clicks duplicate-free.
 *
 * Extensibility seam (prompt Step 14): every future output kind (fills, candles, bar/bg
 * coloring, drawings, strategy reports) is already present in `OutputCollector`; adding
 * support is one more `sync*` method here, with no change to the runner, hooks, or UI.
 */
export class PlotRenderer {
  private readonly chart: IChartApi;
  private readonly candleSeries: ISeriesApi<'Candlestick'>;
  private tracked = new Map<string, Tracked>();
  private paneHeightSet = false;
  private drawingsPrimitive: DrawingsPrimitive | null = null;
  private drawingsHost: HostSeries | null = null;
  /** One fills primitive per pane — `force_overlay` can split a script's fills across both. */
  private fillsByPane = new Map<number, { primitive: FillsPrimitive; host: HostSeries }>();
  private backgroundPrimitive: BackgroundPrimitive | null = null;
  private backgroundHost: HostSeries | null = null;
  private markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
  private markersHost: HostSeries | null = null;
  /** Set per render: the price span a plotless pane's host must cover. */
  private hostExtent: PriceExtent | null = null;

  constructor(chart: IChartApi, candleSeries: ISeriesApi<'Candlestick'>) {
    this.chart = chart;
    this.candleSeries = candleSeries;
  }

  /** Applies a fresh run's outputs. Reuses series where possible; drops what's no longer present. */
  render(
    outputs: OutputCollector,
    drawings: readonly DrawObject[],
    candles: readonly Candle[],
    overlay: boolean,
    /** Widen the view if drawings sit off-screen. Only a full Run does this; an input-driven
     *  re-run must leave the user's zoom/scroll exactly where it was. */
    revealDrawings = false,
  ): void {
    const seen = new Set<string>();
    const paneIndex = overlay ? OVERLAY_PANE : SEPARATE_PANE;
    // Only matters when the pane ends up with no plot to host on; computing it is cheap and
    // paneHostFor is reached from four different syncs, so resolve it once up front.
    this.hostExtent = paneIndex === OVERLAY_PANE ? null : drawingsPriceExtent(drawings);
    // Resolved once: syncFills needs the same answer syncPlots reached, since a fill lives on
    // whichever pane its two bounding plots went to.
    const plotPanes = new Map<number, number>();
    for (const [id, plot] of outputs.plots) {
      plotPanes.set(id, forcesOverlay(plot.options) ? OVERLAY_PANE : paneIndex);
    }
    this.syncPlots(outputs.plots, candles, paneIndex, seen, plotPanes);
    this.syncCandles(outputs.candles, candles, paneIndex, seen);
    this.syncBackground(outputs, candles, paneIndex, seen);
    this.syncFills(outputs, candles, paneIndex, seen, plotPanes);
    this.syncHlines(outputs.hlines, candles, paneIndex, seen);
    this.syncMarkers(outputs.markers, candles, paneIndex, seen);
    this.syncDrawings(drawings, candles, paneIndex, seen);
    this.sweep(seen);
    if (revealDrawings) this.revealDrawings(drawings, candles);
  }

  /**
   * Scripts that render a profile to the right of price (`bar_index + 50` and beyond) place
   * their output past the last candle, where the default view never reaches. Widen to the
   * right so it is on screen — but only when it actually falls outside the current range, so
   * a user who has already scrolled there is left alone.
   */
  private revealDrawings(drawings: readonly DrawObject[], candles: readonly Candle[]): void {
    if (drawings.length === 0 || candles.length === 0) return;
    const extent = drawingsRightExtent(drawings, candles);
    if (extent === null || extent <= candles.length - 1) return;

    const timeScale = this.chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range || extent <= range.to) return;

    // Scroll right, keeping the window the same width. Stretching `to` instead would squeeze
    // the whole history into the same pixels and shrink the profile to an unreadable sliver.
    const to = extent + 5;
    timeScale.setVisibleLogicalRange({ from: to - (range.to - range.from), to });
  }

  /** Removes every series/price-line this renderer owns, e.g. before a fresh compile. */
  clear(): void {
    this.sweep(new Set());
    this.detachDrawings();
    this.detachFills();
    this.detachBackground();
    this.detachMarkers();
  }

  private syncPlots(
    plots: ReadonlyMap<number, PlotSeries>,
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
    plotPanes: ReadonlyMap<number, number>,
  ): void {
    let usedSeparatePane = false;

    for (const [id, plot] of plots) {
      const plotPane = plotPanes.get(id) ?? paneIndex;
      if (plotPane !== OVERLAY_PANE) usedSeparatePane = true;
      const style = typeof plot.options.style === 'string' ? plot.options.style : '';
      // A `*br` plot becomes one series per unbroken run; everything else stays a single
      // series whose `na` gaps are joined, which is what the non-`br` styles mean.
      const runs = BREAK_ON_NA_STYLES.has(style) ? splitPlotRuns(plot, candles) : [plotToLineData(plot, candles)];
      const visible = isVisible(plot.options);

      runs.forEach((points, run) => {
        // Run 0 keeps the plain `plot:<id>` key so a non-broken plot's series is reused
        // untouched across re-runs; extra runs get suffixed keys and `sweep` collects any
        // that a later run no longer produces.
        const key = run === 0 ? `plot:${id}` : `plot:${id}#${run}`;
        seen.add(key);
        const existing = this.tracked.get(key);
        const api =
          existing?.kind === 'plot' && existing.paneIndex === plotPane
            ? existing.api
            : this.recreatePlotSeries(key, existing, plotPane);

        api.applyOptions({
          // One legend entry and one price label for the whole plot, not one per run.
          title: run === 0 ? plot.title : '',
          color: seriesLegendColor(plot.colors),
          lineWidth: asLineWidth(plot.options.linewidth),
          lineType: lineTypeFor(plot.options),
          visible,
          lastValueVisible: run === runs.length - 1,
        });
        api.setData(points);
        this.tracked.set(key, { kind: 'plot', paneIndex: plotPane, api, visible });
      });
    }
    // Only grow the lower pane if something actually landed there — a script whose every plot
    // is force_overlay leaves it empty.
    if (usedSeparatePane) this.ensurePaneHeight();
  }

  private recreatePlotSeries(key: string, existing: Tracked | undefined, paneIndex: number): ISeriesApi<'Line'> {
    if (existing?.kind === 'plot') this.chart.removeSeries(existing.api);
    const api = this.chart.addSeries(LineSeries, {}, paneIndex);
    this.tracked.set(key, { kind: 'plot', paneIndex, api, visible: true });
    return api;
  }

  /**
   * `plotcandle()` / `plotbar()` — a script-drawn candle series. Overlay scripts use it to
   * repaint the price bars (momentum/heikin-ashi style colouring), so it sits on the same
   * pane and covers the chart's own candles bar-for-bar.
   */
  private syncCandles(
    series: ReadonlyMap<number, CandleSeries>,
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
  ): void {
    for (const [id, candleSeries] of series) {
      const key = `candle:${id}`;
      seen.add(key);
      const existing = this.tracked.get(key);

      let api: ISeriesApi<'Candlestick'>;
      if (existing?.kind === 'candle' && existing.paneIndex === paneIndex) {
        api = existing.api;
      } else {
        if (existing?.kind === 'candle') this.chart.removeSeries(existing.api);
        api = this.chart.addSeries(CandlestickSeries, { borderVisible: true }, paneIndex);
      }
      api.applyOptions({ title: candleSeries.title });
      api.setData(candleSeriesToData(candleSeries, candles));
      this.tracked.set(key, { kind: 'candle', paneIndex, api });
    }
  }

  private syncHlines(hlines: ReadonlyMap<number, HLine>, candles: readonly Candle[], paneIndex: number, seen: Set<string>): void {
    for (const [id, hline] of hlines) {
      const key = `hline:${id}`;
      seen.add(key);
      const existing = this.tracked.get(key);
      if (existing?.kind === 'hline') {
        existing.host.removePriceLine(existing.priceLine);
      }
      const host = this.paneHostFor(paneIndex, candles, seen);
      const priceLine = host.createPriceLine({
        price: hline.price,
        title: hline.title,
        color: '#758696',
        lineWidth: 1,
      });
      this.tracked.set(key, { kind: 'hline', paneIndex, host, priceLine });
    }
  }

  /**
   * The candlestick series hosts pane 0. Other panes prefer an already-drawn plot series —
   * it carries real data, so it participates in the pane's price scale, which a
   * whitespace-only series does not (and anything anchored to a scale-less series silently
   * fails to place). A hidden plot is skipped: lightweight-charts suppresses price lines and
   * primitives attached to an invisible series along with the series itself.
   *
   * When the pane has no plot at all — a gauge drawn purely from polylines, say — the host is
   * seeded with REAL values spanning `hostExtent` rather than whitespace, and reports that
   * range through `autoscaleInfoProvider`. Whitespace alone leaves the pane without a price
   * scale, and every drawing on it silently fails to place.
   */
  private paneHostFor(paneIndex: number, candles: readonly Candle[], seen: Set<string>): HostSeries {
    if (paneIndex === OVERLAY_PANE) return this.candleSeries;

    for (const entry of this.tracked.values()) {
      if (entry.kind === 'plot' && entry.paneIndex === paneIndex && entry.visible) return entry.api;
    }

    const key = `panehost:${paneIndex}`;
    seen.add(key);
    const extent = this.hostExtent;
    const existing = this.tracked.get(key);

    if (existing?.kind === 'panehost') {
      if (extent && !sameExtent(existing.extent, extent)) this.seedPaneHost(existing.api, candles, extent);
      return existing.api;
    }

    const api = this.chart.addSeries(LineSeries, HOST_SERIES_OPTIONS, paneIndex);
    if (extent) this.seedPaneHost(api, candles, extent);
    else api.setData(candlesToWhitespace(candles));
    this.tracked.set(key, { kind: 'panehost', paneIndex, api, extent: extent ?? undefined });
    return api;
  }

  /** Gives a plotless pane a price scale: a flat, fully transparent series that declares the
   *  range the drawings actually occupy. */
  private seedPaneHost(api: ISeriesApi<'Line'>, candles: readonly Candle[], extent: PriceExtent): void {
    // A zero-height range gives lightweight-charts nothing to scale against, so open it up.
    const pad = extent.max > extent.min ? 0 : 1;
    const minValue = extent.min - pad;
    const maxValue = extent.max + pad;
    const level = (minValue + maxValue) / 2;

    api.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue, maxValue } }) });
    api.setData(candles.map((c) => ({ time: c.time, value: level })));
  }

  /**
   * `plotshape` / `plotchar` / `plotarrow` markers.
   *
   * All marker series on a pane share ONE plugin bound to that pane's real host series. An
   * earlier version gave each its own transparent line series seeded with whitespace — but a
   * whitespace-only series never joins the pane's price scale, so lightweight-charts had no
   * price to anchor against and every marker silently failed to draw.
   */
  private syncMarkers(
    markers: ReadonlyMap<number, MarkerSeries>,
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
  ): void {
    const all: SeriesMarker<Time>[] = [];
    for (const marker of markers.values()) {
      all.push(...markersToSeriesMarkers(marker, candles));
    }
    if (all.length === 0) {
      this.markersPlugin?.setMarkers([]);
      return;
    }
    // lightweight-charts requires markers in ascending time order.
    all.sort((a, b) => (a.time as number) - (b.time as number));

    const host = this.paneHostFor(paneIndex, candles, seen);
    if (this.markersHost !== host) {
      this.detachMarkers();
      this.markersHost = host;
      this.markersPlugin = createSeriesMarkers(host, []);
    }
    this.markersPlugin?.setMarkers(all);
  }

  private detachMarkers(): void {
    this.markersPlugin?.detach();
    this.markersPlugin = null;
    this.markersHost = null;
  }

  /**
   * Boxes/lines/labels are painted by a single primitive attached to the pane's host series.
   * Re-attaches only when the host changes (e.g. overlay flipped), so a re-run just swaps
   * the data and repaints.
   */
  private syncDrawings(
    drawings: readonly DrawObject[],
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
  ): void {
    if (drawings.length === 0) {
      this.detachDrawings();
      return;
    }

    const host = this.paneHostFor(paneIndex, candles, seen);
    if (this.drawingsHost !== host) {
      this.detachDrawings();
      this.drawingsPrimitive = new DrawingsPrimitive();
      this.drawingsHost = host;
      host.attachPrimitive(this.drawingsPrimitive);
    }
    this.drawingsPrimitive?.setData(drawings, candles);
  }

  private detachDrawings(): void {
    if (this.drawingsPrimitive && this.drawingsHost) {
      this.drawingsHost.detachPrimitive(this.drawingsPrimitive);
    }
    this.drawingsPrimitive = null;
    this.drawingsHost = null;
  }

  /** `fill()` regions between two plots, painted by a primitive (no native LWC equivalent). */
  private syncFills(
    outputs: OutputCollector,
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
    plotPanes: ReadonlyMap<number, number>,
  ): void {
    const resolved = resolveFills(outputs.fills, outputs.plots, outputs.hlines, candles.length);

    // A fill belongs wherever its bounding plots went, so `force_overlay` on those carries the
    // fill along with them. An hline boundary is not in the map and keeps the script's pane.
    const byPane = new Map<number, ResolvedFill[]>();
    for (const fill of resolved) {
      const pane = plotPanes.get(fill.region.plot1) ?? plotPanes.get(fill.region.plot2) ?? paneIndex;
      const bucket = byPane.get(pane);
      if (bucket) bucket.push(fill);
      else byPane.set(pane, [fill]);
    }

    for (const [pane, entry] of this.fillsByPane) {
      if (!byPane.has(pane)) {
        entry.host.detachPrimitive(entry.primitive);
        this.fillsByPane.delete(pane);
      }
    }

    for (const [pane, fills] of byPane) {
      const host = this.paneHostFor(pane, candles, seen);
      let entry = this.fillsByPane.get(pane);
      if (!entry || entry.host !== host) {
        if (entry) entry.host.detachPrimitive(entry.primitive);
        entry = { primitive: new FillsPrimitive(), host };
        host.attachPrimitive(entry.primitive);
        this.fillsByPane.set(pane, entry);
      }
      entry.primitive.setData(fills, candles.length);
    }
  }

  private detachFills(): void {
    for (const entry of this.fillsByPane.values()) {
      entry.host.detachPrimitive(entry.primitive);
    }
    this.fillsByPane.clear();
  }

  /** `bgcolor()` layers, painted as full-height vertical bands behind everything else. */
  private syncBackground(
    outputs: OutputCollector,
    candles: readonly Candle[],
    paneIndex: number,
    seen: Set<string>,
  ): void {
    const layers = [...outputs.bgColors.values()].filter((layer) => layer.some(Boolean));
    if (layers.length === 0) {
      this.detachBackground();
      return;
    }

    const host = this.paneHostFor(paneIndex, candles, seen);
    if (this.backgroundHost !== host) {
      this.detachBackground();
      this.backgroundPrimitive = new BackgroundPrimitive();
      this.backgroundHost = host;
      host.attachPrimitive(this.backgroundPrimitive);
    }
    this.backgroundPrimitive?.setData(layers, candles.length);
  }

  private detachBackground(): void {
    if (this.backgroundPrimitive && this.backgroundHost) {
      this.backgroundHost.detachPrimitive(this.backgroundPrimitive);
    }
    this.backgroundPrimitive = null;
    this.backgroundHost = null;
  }

  private ensurePaneHeight(): void {
    if (this.paneHeightSet) return;
    const panes = this.chart.panes();
    if (panes.length > 1) {
      panes[1].setHeight(Math.round((panes[0]?.getHeight() ?? 300) * 0.4));
      this.paneHeightSet = true;
    }
  }

  private sweep(seen: Set<string>): void {
    for (const [key, entry] of this.tracked) {
      if (seen.has(key)) continue;
      if (entry.kind === 'hline') {
        entry.host.removePriceLine(entry.priceLine);
      } else {
        this.chart.removeSeries(entry.api);
      }
      this.tracked.delete(key);
    }
    if (seen.size === 0) this.paneHeightSet = false;
  }
}
