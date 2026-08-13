import { useEffect, useState } from 'react';
import { fetchCandles } from '../lib/api';
import type { Candle } from '../types/candle';

interface UseCandlesResult {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

/** Fetches the symbol's OHLCV from the backend once per symbol/timeframe/window. */
export function useCandles(symbol: string, timeframe: string, bars?: number): UseCandlesResult {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const loaded = await fetchCandles(symbol, timeframe, bars);
        if (cancelled) return;
        setCandles(loaded);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, bars]);

  return { candles, loading, error };
}
