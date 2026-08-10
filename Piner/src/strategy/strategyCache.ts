import type { Candle } from '../types/candle';
import type { InputValues } from '../types/inputs';
import type { ExecuteStrategyOutcome } from './strategyExecutor';
import type { StrategyConfig } from './types';

const MAX_ENTRIES = 6;

export interface CacheKeyParts {
  source: string;
  symbol: string;
  timeframe: string;
  candles: readonly Candle[];
  config: StrategyConfig;
  inputs: InputValues;
}

/**
 * Everything a run's output depends on. The dataset is fingerprinted (length + first/last bar
 * time + last close) rather than hashed in full — swapping the CSV or appending bars changes
 * it, while re-running the same dataset does not, and it stays O(1) on a million bars.
 */
export function cacheKey(parts: CacheKeyParts): string {
  const { candles } = parts;
  const fingerprint =
    candles.length === 0
      ? 'empty'
      : `${candles.length}:${candles[0].time}:${candles[candles.length - 1].time}:${candles[candles.length - 1].close}`;

  return JSON.stringify([
    parts.source,
    parts.symbol,
    parts.timeframe,
    fingerprint,
    parts.config,
    // Object key order follows the input schema, which is stable for a given source.
    parts.inputs,
  ]);
}

/**
 * Small LRU over completed backtests, so flipping a dashboard tab or toggling a chart overlay
 * never re-runs the engine. Any change to source, dataset, inputs or settings produces a
 * different key, so a stale result cannot survive a configuration change.
 */
export class StrategyCache {
  private readonly entries = new Map<string, ExecuteStrategyOutcome>();

  get(key: string): ExecuteStrategyOutcome | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: ExecuteStrategyOutcome): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
