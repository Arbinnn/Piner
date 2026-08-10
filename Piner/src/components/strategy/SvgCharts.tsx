/**
 * The small non-time-series charts the analysis sections need, as inline SVG.
 *
 * lightweight-charts covers everything plotted against time; these four shapes (categorical
 * bars, a donut, a histogram, comparison bars) are not time series, and hand-drawn SVG is both
 * smaller and more controllable than bending a financial charting library into them — with no
 * new dependency. All of them read their colours from the theme tokens.
 */

import { memo } from 'react';
import { formatCompactMoney, formatPercent } from '../../lib/format';

const POSITIVE = 'var(--positive)';
const NEGATIVE = 'var(--negative)';
const AXIS = 'var(--border)';
const DIM = 'var(--text-dim)';

export interface BarItem {
  label: string;
  value: number;
  color: string;
}

/** Categorical bars around a zero baseline (Profit structure: profit / loss / commission / net). */
function BarChartImpl({ items, height = 200 }: { items: readonly BarItem[]; height?: number }): React.JSX.Element {
  const width = 460;
  const padTop = 14;
  const padBottom = 26;
  const plot = height - padTop - padBottom;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const zeroY = padTop + (plot * max) / (max * 2);
  const slot = width / Math.max(1, items.length);
  const barWidth = Math.min(56, slot * 0.5);

  return (
    <div className="svg-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Profit structure">
        <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke={AXIS} strokeWidth={1} />
        {items.map((item, i) => {
          const cx = slot * i + slot / 2;
          const magnitude = (Math.abs(item.value) / (max * 2)) * plot;
          const y = item.value >= 0 ? zeroY - magnitude : zeroY;
          return (
            <g key={item.label}>
              <rect x={cx - barWidth / 2} y={y} width={barWidth} height={Math.max(1, magnitude)} fill={item.color} rx={2} />
              <text
                x={cx}
                y={item.value >= 0 ? y - 5 : y + magnitude + 13}
                textAnchor="middle"
                fontSize={11}
                fill={DIM}
              >
                {formatCompactMoney(item.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="svg-chart__legend">
        {items.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export const BarChart = memo(BarChartImpl);

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Trades distribution: winners / losers / breakevens. */
function DonutChartImpl({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: readonly DonutSegment[];
  centerValue: string;
  centerLabel: string;
}): React.JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const size = 180;
  const radius = 70;
  const stroke = 26;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={centerLabel}>
        <g transform={`translate(${size / 2} ${size / 2}) rotate(-90)`}>
          <circle r={radius} fill="none" stroke="var(--bg-inset)" strokeWidth={stroke} />
          {total > 0 &&
            segments.map((segment) => {
              const fraction = segment.value / total;
              const dash = fraction * circumference;
              const element = (
                <circle
                  key={segment.label}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return element;
            })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={20} fontWeight={600} fill="var(--text)">
          {centerValue}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize={11} fill={DIM}>
          {centerLabel}
        </text>
      </svg>
      <ul className="donut__legend">
        {segments.map((segment) => (
          <li key={segment.label}>
            <i style={{ background: segment.color }} />
            <span className="donut__legend-label">{segment.label}</span>
            <span className="donut__legend-value">
              {segment.value} trades
              <em>{total > 0 ? formatPercent((segment.value / total) * 100) : formatPercent(null)}</em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const DonutChart = memo(DonutChartImpl);

export interface HistogramBin {
  /** Left edge, percent. */
  from: number;
  to: number;
  count: number;
}

/** Returns distribution: losing bins red, winning bins green, with the two averages marked. */
function HistogramImpl({
  bins,
  averageLossPercent,
  averageProfitPercent,
  height = 200,
}: {
  bins: readonly HistogramBin[];
  averageLossPercent: number | null;
  averageProfitPercent: number | null;
  height?: number;
}): React.JSX.Element {
  const width = 520;
  const padBottom = 22;
  const plot = height - padBottom - 8;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const minEdge = bins.length > 0 ? bins[0].from : -10;
  const maxEdge = bins.length > 0 ? bins[bins.length - 1].to : 10;
  const span = maxEdge - minEdge || 1;
  const xOf = (percent: number): number => ((percent - minEdge) / span) * width;

  const marker = (value: number | null, color: string, label: string): React.JSX.Element | null => {
    if (value === null) return null;
    const x = Math.max(0, Math.min(width, xOf(value)));
    return (
      <g key={label}>
        <line x1={x} x2={x} y1={4} y2={plot + 8} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
      </g>
    );
  };

  return (
    <div className="svg-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Returns distribution">
        <line x1={0} x2={width} y1={plot + 8} y2={plot + 8} stroke={AXIS} />
        {bins.map((bin) => {
          const x = xOf(bin.from);
          const w = Math.max(2, xOf(bin.to) - x - 2);
          const h = (bin.count / maxCount) * plot;
          return (
            <rect
              key={`${bin.from}`}
              x={x + 1}
              y={plot + 8 - h}
              width={w}
              height={h}
              rx={1.5}
              fill={bin.to <= 0 ? NEGATIVE : POSITIVE}
              opacity={0.9}
            />
          );
        })}
        {marker(averageLossPercent, NEGATIVE, 'avg-loss')}
        {marker(averageProfitPercent, POSITIVE, 'avg-profit')}
        {[minEdge, minEdge / 2, 0, maxEdge / 2, maxEdge].map((tick) => (
          <text key={tick} x={xOf(tick)} y={height - 6} textAnchor="middle" fontSize={10} fill={DIM}>
            {tick.toFixed(0)}%
          </text>
        ))}
      </svg>
      <div className="svg-chart__legend">
        <span>
          <i style={{ background: NEGATIVE }} />
          Losers
        </span>
        <span>
          <i style={{ background: POSITIVE }} />
          Winners
        </span>
        <span className="svg-chart__legend-dashed">
          <i style={{ background: NEGATIVE }} />
          Average loss {formatPercent(averageLossPercent, { signed: true })}
        </span>
        <span className="svg-chart__legend-dashed">
          <i style={{ background: POSITIVE }} />
          Average profit {formatPercent(averageProfitPercent, { signed: true })}
        </span>
      </div>
    </div>
  );
}

export const Histogram = memo(HistogramImpl);

export interface ComparisonRow {
  label: string;
  value: number;
  display: string;
}

/** Horizontal Max / Average / Current bars, shared scale across both groups. */
function ComparisonBarsImpl({
  rows,
  max,
  color,
}: {
  rows: readonly ComparisonRow[];
  max: number;
  color: string;
}): React.JSX.Element {
  return (
    <div className="comparison">
      {rows.map((row) => (
        <div className="comparison__row" key={row.label}>
          <span className="comparison__label">{row.label}</span>
          <span className="comparison__track">
            <span
              className="comparison__bar"
              style={{ width: `${max > 0 ? Math.min(100, (row.value / max) * 100) : 0}%`, background: color }}
            />
          </span>
          <span className="comparison__value">{row.display}</span>
        </div>
      ))}
    </div>
  );
}

export const ComparisonBars = memo(ComparisonBarsImpl);

export interface PhaseBar {
  kind: 'runup' | 'drawdown';
  percent: number;
  open: boolean;
  label: string;
}

/** Alternating growth and decline: one bar per equity phase, up for run-ups, down for drawdowns. */
function PhaseBarsImpl({ phases, height = 200 }: { phases: readonly PhaseBar[]; height?: number }): React.JSX.Element {
  const width = 520;
  const mid = height / 2;
  const max = Math.max(0.0001, ...phases.map((p) => p.percent));
  const slot = width / Math.max(1, phases.length);
  const barWidth = Math.max(2, Math.min(18, slot * 0.7));

  return (
    <div className="svg-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Alternating growth and decline">
        <line x1={0} x2={width} y1={mid} y2={mid} stroke={AXIS} />
        {phases.map((phase, i) => {
          const h = (phase.percent / max) * (mid - 10);
          const up = phase.kind === 'runup';
          return (
            <rect
              key={`${phase.label}-${i}`}
              x={slot * i + (slot - barWidth) / 2}
              y={up ? mid - h : mid}
              width={barWidth}
              height={Math.max(1, h)}
              rx={1.5}
              fill={up ? POSITIVE : NEGATIVE}
              opacity={phase.open ? 0.55 : 1}
            >
              <title>{phase.label}</title>
            </rect>
          );
        })}
      </svg>
      <div className="svg-chart__legend">
        <span>
          <i style={{ background: POSITIVE }} />
          Run-up
        </span>
        <span>
          <i style={{ background: NEGATIVE }} />
          Drawdown
        </span>
        <span className="svg-chart__legend-faded">
          <i style={{ background: DIM }} />
          Still open
        </span>
      </div>
    </div>
  );
}

export const PhaseBars = memo(PhaseBarsImpl);
