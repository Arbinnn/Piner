import type { Bar } from '@heyphat/piner';
import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../types/candle';

const REQUIRED_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;

/** Parses OHLCV CSV text into sorted, deduplicated candles. Header/blank/whitespace tolerant. */
export function parseCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/);
  const rows: Candle[] = [];
  let columnOrder: readonly string[] = REQUIRED_COLUMNS;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const cells = line.split(',').map((cell) => cell.trim());
    const first = cells[0]?.toLowerCase();

    if (first === 'date' || first === 'time') {
      columnOrder = cells.map((c) => c.toLowerCase());
      continue;
    }

    const candle = rowToCandle(cells, columnOrder);
    if (candle) rows.push(candle);
  }

  rows.sort((a, b) => a.time - b.time);
  return dedupeByTime(rows);
}

function rowToCandle(cells: string[], columns: readonly string[]): Candle | null {
  const get = (name: string): string | undefined => {
    const idx = columns.indexOf(name);
    return idx === -1 ? undefined : cells[idx];
  };

  const dateStr = get('date');
  const open = Number(get('open'));
  const high = Number(get('high'));
  const low = Number(get('low'));
  const close = Number(get('close'));
  const volume = Number(get('volume') ?? '0');

  if (!dateStr) return null;
  const time = toUnixSeconds(dateStr);
  if (time === null) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;

  return {
    time: time as UTCTimestamp,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function toUnixSeconds(dateStr: string): number | null {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function dedupeByTime(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (out.length > 0 && out[out.length - 1].time === c.time) {
      out[out.length - 1] = c;
    } else {
      out.push(c);
    }
  }
  return out;
}

/** Fetches and parses a CSV asset URL into candles. */
export async function loadCandles(url: string): Promise<Candle[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load CSV: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseCsv(text);
}

/** Converts chart-native (seconds) candles into piner's Bar shape (milliseconds). */
export function toPinerBars(candles: readonly Candle[]): Bar[] {
  return candles.map((c) => ({
    time: c.time * 1000,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}
