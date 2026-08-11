import { memo, useEffect, useRef } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { THEME } from '../../lib/chart';

export interface MiniChartPoint {
  time: number;
  value: number;
}

export interface MiniChartSeries {
  /** Stable identity — changing it recreates the series. */
  id: string;
  label: string;
  data: readonly MiniChartPoint[];
  color: string;
  /** Area fill under the line; a plain line when omitted. */
  fill?: string;
  dashed?: boolean;
}

interface StrategyMiniChartProps {
  series: readonly MiniChartSeries[];
  height?: number;
  /** Horizontal reference line (initial capital on equity, 0 on drawdown). */
  baseline?: number;
  ariaLabel: string;
}

/**
 * A small read-only lightweight-charts pane for the equity / benchmark / drawdown curves.
 *
 * This is NOT a second price chart (section 31) — the candlestick chart stays the single
 * instance the strategy overlays are drawn on. Reusing lightweight-charts here rather than
 * hand-rolling SVG keeps the crosshair, time axis and theme identical to the main chart for
 * free, and adds no dependency.
 */
function StrategyMiniChartImpl({ series, height = 200, baseline, ariaLabel }: StrategyMiniChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<string, ISeriesApi<'Area'> | ISeriesApi<'Line'>>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: THEME.text,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: { borderColor: THEME.border, timeVisible: false },
      handleScale: false,
      handleScroll: false,
      width: container.clientWidth,
      height,
    });
    chartRef.current = chart;
    const tracked = seriesRef.current;

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => chart.applyOptions({ width: entry.contentRect.width, height }));
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      tracked.clear();
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const tracked = seriesRef.current;
    const wanted = new Set(series.map((s) => s.id));

    for (const [id, api] of tracked) {
      if (!wanted.has(id)) {
        chart.removeSeries(api);
        tracked.delete(id);
      }
    }

    for (const spec of series) {
      let api = tracked.get(spec.id);
      if (!api) {
        api = spec.fill
          ? chart.addSeries(AreaSeries, { lineColor: spec.color, topColor: spec.fill, bottomColor: 'rgba(0,0,0,0)' })
          : chart.addSeries(LineSeries, { color: spec.color });
        tracked.set(spec.id, api);
      }
      api.applyOptions({
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        lineStyle: spec.dashed ? LineStyle.Dashed : LineStyle.Solid,
        ...(spec.fill ? { lineColor: spec.color, topColor: spec.fill } : { color: spec.color }),
      });
      api.setData(spec.data.map((p) => ({ time: p.time as Time, value: p.value })) as (AreaData<Time> & LineData<Time>)[]);
    }

    chart.timeScale().fitContent();
  }, [series]);

  useEffect(() => {
    const first = seriesRef.current.values().next();
    if (first.done || baseline === undefined) return;
    const line = first.value.createPriceLine({
      price: baseline,
      color: THEME.border,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    });
    return () => {
      first.value.removePriceLine(line);
    };
  }, [baseline, series]);

  return (
    <div className="strategy-chart">
      {series.length > 1 && (
        <div className="strategy-chart__legend">
          {series.map((s) => (
            <span className="strategy-chart__legend-item" key={s.id}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="strategy-minichart" ref={containerRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}

export const StrategyMiniChart = memo(StrategyMiniChartImpl);
