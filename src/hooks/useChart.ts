import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { applyChartTheme, createPineChart, type ChartTheme } from '../lib/chart';
import { PlotRenderer } from '../lib/plotRenderer';
import type { Candle } from '../types/candle';

interface UseChartResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.RefObject<IChartApi | null>;
  candleSeriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  rendererRef: React.RefObject<PlotRenderer | null>;
}

/**
 * Owns the lightweight-charts instance lifecycle: create once, resize-observe, remove on
 * unmount. Also owns the base candlestick data — populated as soon as `candles` arrives,
 * independent of whether a Pine script has run yet — and the one-time initial `fitContent()`,
 * so indicator re-runs (Step 11) never disturb the user's zoom/scroll afterwards.
 */
export function useChart(candles: readonly Candle[], theme: ChartTheme = 'dark'): UseChartResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const rendererRef = useRef<PlotRenderer | null>(null);
  const hasFitRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { chart, candleSeries } = createPineChart(container, theme);
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    rendererRef.current = new PlotRenderer(chart, candleSeries);

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      });
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      rendererRef.current = null;
      hasFitRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (candles.length === 0) return;
    candleSeriesRef.current?.setData(candles as Candle[]);
    if (!hasFitRef.current) {
      chartRef.current?.timeScale().fitContent();
      hasFitRef.current = true;
    }
  }, [candles]);

  useEffect(() => {
    if (chartRef.current) applyChartTheme(chartRef.current, theme);
  }, [theme]);

  return { containerRef, chartRef, candleSeriesRef, rendererRef };
}
