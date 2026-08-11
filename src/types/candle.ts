import type { UTCTimestamp } from 'lightweight-charts';

/** One OHLCV bar, chart-native: `time` is epoch SECONDS (lightweight-charts). */
export interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlotPoint {
  time: UTCTimestamp;
  value: number;
}

export type ConsoleLevel = 'info' | 'warning' | 'error';

export interface ConsoleEntry {
  id: number;
  level: ConsoleLevel;
  /** e.g. 'Compilation Error', 'Runtime Error', 'Run' */
  heading: string;
  message: string;
  /** Present for compile diagnostics. */
  line?: number;
  col?: number;
}
