import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';

export type ChartTheme = 'dark' | 'light';

/** Chart canvas palettes, kept in step with the CSS custom properties in index.css. */
export const THEMES = {
  dark: {
    background: '#0b0d10',
    text: '#e9e7e0',
    grid: '#171b1f',
    border: '#232830',
    upColor: '#34d399',
    downColor: '#ff5c5c',
    crosshair: '#565a61',
    /* Benchmark (buy & hold) line — deliberately neutral so it never reads as a P&L colour. */
    benchmark: '#83868c',
    accent: '#f5a623',
  },
  light: {
    background: '#ffffff',
    text: '#1b1a17',
    grid: '#efece2',
    border: '#e2ddcf',
    upColor: '#1f9d6e',
    downColor: '#d1435a',
    crosshair: '#b8b3a4',
    benchmark: '#6c6a63',
    accent: '#b3690f',
  },
} as const satisfies Record<ChartTheme, Record<string, string>>;

/** Back-compat alias for existing dark-theme consumers (e.g. the benchmark/marker colours). */
export const THEME = THEMES.dark;

/** Applies a chart theme's colours to an already-created chart's layout, grid and scales. */
export function applyChartTheme(chart: IChartApi, theme: ChartTheme): void {
  const t = THEMES[theme];
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: t.background },
      textColor: t.text,
      panes: { separatorColor: t.border },
    },
    grid: {
      vertLines: { color: t.grid },
      horzLines: { color: t.grid },
    },
    crosshair: {
      vertLine: { color: t.crosshair, labelBackgroundColor: t.crosshair },
      horzLine: { color: t.crosshair, labelBackgroundColor: t.crosshair },
    },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border },
  });
}

/** Creates a themed chart with crosshair, visible scales, and a candlestick series on pane 0. */
export function createPineChart(
  container: HTMLElement,
  theme: ChartTheme = 'dark',
): {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
} {
  const THEME = THEMES[theme];
  const chart = createChart(container, {
    layout: {
      background: { type: ColorType.Solid, color: THEME.background },
      textColor: THEME.text,
      panes: { separatorColor: THEME.border },
    },
    grid: {
      vertLines: { color: THEME.grid },
      horzLines: { color: THEME.grid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: THEME.crosshair, labelBackgroundColor: THEME.crosshair },
      horzLine: { color: THEME.crosshair, labelBackgroundColor: THEME.crosshair },
    },
    rightPriceScale: {
      visible: true,
      borderColor: THEME.border,
    },
    timeScale: {
      visible: true,
      timeVisible: false,
      secondsVisible: false,
      borderColor: THEME.border,
      rightOffset: 6,
    },
    autoSize: false,
    width: container.clientWidth,
    height: container.clientHeight,
  });

  const candleSeries = chart.addSeries(
    CandlestickSeries,
    {
      upColor: THEME.upColor,
      downColor: THEME.downColor,
      borderVisible: false,
      wickUpColor: THEME.upColor,
      wickDownColor: THEME.downColor,
    },
    0,
  );

  return { chart, candleSeries };
}
