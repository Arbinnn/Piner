import type { SeriesMarker, Time } from 'lightweight-charts';
import { THEME } from '../lib/chart';
import type { OpenPosition, StrategyVisibility, Trade, TradeDirection } from './types';

/** What a marker stands for — the payload the chart tooltip renders on hover. */
export interface MarkerInfo {
  kind: 'entry' | 'exit' | 'open';
  /** 1-based trade number; `null` for a still-open entry. */
  tradeIndex: number | null;
  direction: TradeDirection;
  price: number;
  quantity: number;
  time: number;
  entryTime: number;
  exitTime: number | null;
  netPnL: number | null;
  returnPercent: number | null;
  durationMs: number | null;
}

export interface StrategyMarkers {
  markers: SeriesMarker<Time>[];
  /** Bar time (seconds) -> the events on it, for the hover tooltip. */
  byTime: Map<number, MarkerInfo[]>;
}

const HIGHLIGHT = THEME.crosshair;
const EXIT_COLOR = '#b2b5be';

/**
 * Entry/exit markers for the price pane.
 *
 * Entries point at the candle from the side the trade leans (long below, short above) and
 * exits use a neutral square on the opposite side, so a round trip reads as two distinct
 * glyphs rather than four arrows fighting over one candle. Text is kept short for the same
 * reason — a long label per marker hides the candles the markers are supposed to annotate.
 */
export function buildStrategyMarkers(
  trades: readonly Trade[],
  openPosition: OpenPosition | null,
  visibility: StrategyVisibility,
  selectedTradeIndex: number | null,
): StrategyMarkers {
  const markers: SeriesMarker<Time>[] = [];
  const byTime = new Map<number, MarkerInfo[]>();

  const push = (marker: SeriesMarker<Time>, info: MarkerInfo): void => {
    markers.push(marker);
    const bucket = byTime.get(info.time);
    if (bucket) bucket.push(info);
    else byTime.set(info.time, [info]);
  };

  for (const trade of trades) {
    const selected = selectedTradeIndex === trade.index;
    const long = trade.direction === 'long';

    if (visibility.entries) {
      push(
        {
          time: trade.entryTime as Time,
          position: long ? 'belowBar' : 'aboveBar',
          shape: long ? 'arrowUp' : 'arrowDown',
          color: selected ? HIGHLIGHT : long ? THEME.upColor : THEME.downColor,
          text: long ? 'BUY' : 'SELL SHORT',
        },
        {
          kind: 'entry',
          tradeIndex: trade.index,
          direction: trade.direction,
          price: trade.entryPrice,
          quantity: trade.quantity,
          time: trade.entryTime,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          netPnL: trade.netPnL,
          returnPercent: trade.returnPercent,
          durationMs: trade.durationMs,
        },
      );
    }

    if (visibility.exits) {
      push(
        {
          time: trade.exitTime as Time,
          position: long ? 'aboveBar' : 'belowBar',
          shape: 'square',
          color: selected ? HIGHLIGHT : EXIT_COLOR,
          text: long ? 'EXIT LONG' : 'EXIT SHORT',
        },
        {
          kind: 'exit',
          tradeIndex: trade.index,
          direction: trade.direction,
          price: trade.exitPrice,
          quantity: trade.quantity,
          time: trade.exitTime,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          netPnL: trade.netPnL,
          returnPercent: trade.returnPercent,
          durationMs: trade.durationMs,
        },
      );
    }
  }

  if (visibility.openPositions && openPosition) {
    for (const lot of openPosition.trades) {
      const long = lot.direction === 'long';
      push(
        {
          time: lot.entryTime as Time,
          position: long ? 'belowBar' : 'aboveBar',
          shape: 'circle',
          color: THEME.crosshair,
          text: long ? 'OPEN LONG' : 'OPEN SHORT',
        },
        {
          kind: 'open',
          tradeIndex: null,
          direction: lot.direction,
          price: lot.entryPrice,
          quantity: lot.quantity,
          time: lot.entryTime,
          entryTime: lot.entryTime,
          exitTime: null,
          netPnL: lot.unrealizedPnL,
          returnPercent: lot.returnPercent,
          durationMs: null,
        },
      );
    }
  }

  // lightweight-charts requires ascending time order.
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return { markers, byTime };
}

const LONG_BG = '#26a69a1f';
const SHORT_BG = '#ef53501f';

/**
 * Per-bar background tint for the bars a position was held over, in the `#RRGGBBAA` form the
 * existing `bgcolor()` primitive already speaks. Kept faint on purpose: the candles have to
 * stay readable through it.
 */
export function buildPositionBackground(directions: readonly ('long' | 'short' | 'flat')[]): (string | null)[] {
  return directions.map((d) => (d === 'long' ? LONG_BG : d === 'short' ? SHORT_BG : null));
}
