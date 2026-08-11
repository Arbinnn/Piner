import { memo, useEffect, useState } from 'react';
import type { IChartApi, MouseEventParams, Time } from 'lightweight-charts';
import { formatDuration, formatMoney, formatPercent, formatPrice, formatQuantity, toneOf } from '../../lib/format';
import type { MarkerInfo } from '../../strategy/markers';

interface StrategyChartTooltipProps {
  chartRef: React.RefObject<IChartApi | null>;
  markersByTime: Map<number, MarkerInfo[]>;
}

interface HoverState {
  x: number;
  y: number;
  infos: MarkerInfo[];
}

const OFFSET = 14;
const TOOLTIP_WIDTH = 210;

/**
 * Hover card for the chart's trade markers.
 *
 * lightweight-charts markers carry no tooltip of their own, so this listens on the crosshair
 * and looks the hovered BAR up in the marker index — which also means hovering anywhere on the
 * bar works, not just the few pixels of the arrow.
 */
function StrategyChartTooltipImpl({ chartRef, markersByTime }: StrategyChartTooltipProps): React.JSX.Element | null {
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: MouseEventParams<Time>): void => {
      const time = param.time as number | undefined;
      const infos = time === undefined ? undefined : markersByTime.get(time);
      if (!param.point || !infos || infos.length === 0) {
        setHover(null);
        return;
      }
      setHover({ x: param.point.x, y: param.point.y, infos });
    };

    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [chartRef, markersByTime]);

  if (!hover) return null;

  return (
    <div
      className="chart-tooltip"
      style={{ left: hover.x + OFFSET, top: hover.y + OFFSET, width: TOOLTIP_WIDTH }}
      role="tooltip"
    >
      {hover.infos.map((info, i) => (
        <div className="chart-tooltip__block" key={`${info.kind}-${info.tradeIndex}-${i}`}>
          <div className="chart-tooltip__title">
            {info.tradeIndex === null ? 'Open Position' : `Trade #${info.tradeIndex}`}
            <span className={`value value--${info.direction === 'long' ? 'positive' : 'negative'}`}>
              {' '}
              {info.direction.toUpperCase()}
            </span>
          </div>
          <div className="chart-tooltip__row">
            <span>{info.kind === 'exit' ? 'Exit' : 'Entry'}</span>
            <span>{formatPrice(info.price)}</span>
          </div>
          <div className="chart-tooltip__row">
            <span>Qty</span>
            <span>{formatQuantity(info.quantity)}</span>
          </div>
          <div className="chart-tooltip__row">
            <span>{info.kind === 'open' ? 'Unrealized' : 'P&L'}</span>
            <span className={`value value--${toneOf(info.netPnL)}`}>{formatMoney(info.netPnL, { signed: true })}</span>
          </div>
          <div className="chart-tooltip__row">
            <span>Return</span>
            <span className={`value value--${toneOf(info.returnPercent)}`}>
              {formatPercent(info.returnPercent, { signed: true })}
            </span>
          </div>
          {info.durationMs !== null && (
            <div className="chart-tooltip__row">
              <span>Duration</span>
              <span>{formatDuration(info.durationMs)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const StrategyChartTooltip = memo(StrategyChartTooltipImpl);
