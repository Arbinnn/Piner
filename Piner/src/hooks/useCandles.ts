import { useEffect, useState } from 'react';
import { loadCandles } from '../lib/csvLoader';
import type { Candle } from '../types/candle';

interface UseCandlesResult {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

/** Loads and parses the CSV dataset once on mount. */
export function useCandles(csvUrl: string): UseCandlesResult {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadCandles(csvUrl);
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
  }, [csvUrl]);

  return { candles, loading, error };
}
