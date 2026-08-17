/**
 * The backend's OHLCV source.
 *
 * Datasets live in `server/data/<SYMBOL>.csv` and are parsed once per process — the frontend
 * no longer loads or parses any of it, it just asks for the bars it should draw. The parser is
 * the one that used to run in the browser, moved verbatim so a bar's time/price is byte-for-byte
 * what the old client produced.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Bar } from '@heyphat/piner';
import type { Candle } from '../src/types/candle.ts';

// `process.cwd()` (not `import.meta.dirname`) — a serverless bundler inlines this module into
// one output file that no longer lives next to `data/`, but the process still starts at the
// project root both locally (`npm run server`) and on Vercel (`/var/task`).
const DATA_DIR = path.join(process.cwd(), 'server', 'data');
/** Filename-safe, and deliberately no `/`, `\` or `.` runs — the path is built from this. */
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const REQUIRED_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;

/** A request the caller got wrong (unknown symbol, bad name) rather than a server fault. */
export class DatasetError extends Error {
  readonly status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = 'DatasetError';
    this.status = status;
  }
}

const datasets = new Map<string, Promise<Candle[]>>();

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
    time: time as Candle['time'],
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

/**
 * The full dataset for a symbol, parsed once and held for the life of the process.
 *
 * The promise (not the result) is cached so concurrent requests for a cold symbol share one
 * read instead of racing to parse the same file.
 */
export function loadSymbol(symbol: string): Promise<Candle[]> {
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new DatasetError(`Invalid symbol '${symbol}'.`, 400);
  }
  const key = symbol.toUpperCase();
  const hit = datasets.get(key);
  if (hit) return hit;

  const pending = readFile(path.join(DATA_DIR, `${key}.csv`), 'utf8')
    .catch(() => {
      throw new DatasetError(`No data for symbol '${key}'.`);
    })
    .then((text) => {
      const candles = parseCsv(text);
      if (candles.length === 0) throw new DatasetError(`Dataset for '${key}' contains no usable rows.`, 422);
      return candles;
    });

  // A failed load must not be cached, or one bad read poisons the symbol until restart.
  pending.catch(() => datasets.delete(key));
  datasets.set(key, pending);
  return pending;
}

/** The most recent `bars` candles, or all of them when no cap was given. */
export function recentBars(candles: readonly Candle[], bars?: number): readonly Candle[] {
  if (bars === undefined || bars >= candles.length) return candles;
  return candles.slice(candles.length - bars);
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

/** O(1) identity of a dataset window, for the result cache key. */
export function fingerprint(candles: readonly Candle[]): string {
  if (candles.length === 0) return 'empty';
  const last = candles[candles.length - 1];
  return `${candles.length}:${candles[0].time}:${last.time}:${last.close}`;
}
