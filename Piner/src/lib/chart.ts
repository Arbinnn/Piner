import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';

/** Shared dark theme palette — used by both the chart canvas and CSS so they can't drift. */
export const THEME = {
  background: '#131722',
  text: '#d1d4dc',
  grid: '#1e222d',
  border: '#2a2e39',
  upColor: '#089981',
  downColor: '#f23645',
  crosshair: '#758696',
  /* Benchmark (buy & hold) line — deliberately neutral so it never reads as a P&L colour. */
  benchmark: '#787b86',
  accent: '#2962ff',
} as const;

/** Creates a dark-themed chart with crosshair, visible scales, and a candlestick series on pane 0. */
export function createPineChart(container: HTMLElement): {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
} {
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
