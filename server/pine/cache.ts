/**
 * Compile and result caches.
 *
 * Two levels, because they invalidate on different things: a compile depends only on the
 * source (and the engine build), while a result also depends on the dataset, the inputs and
 * the backtest settings. Both are plain in-process LRUs — the key function is the part that
 * matters, and it is what a Redis/BullMQ backend would key on too.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { CompiledScript } from '@heyphat/piner';
import type { ExecuteResponse } from '../../src/types/pine.ts';

const MAX_COMPILED = 50;
const MAX_RESULTS = 40;

/**
 * The engine build the cached artifacts belong to. Upgrading `@heyphat/piner` must not serve a
 * script compiled by the previous version, so the version is part of every key.
 */
export const ENGINE_VERSION: string = readEngineVersion();

function readEngineVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // The package's `exports` map does not publish `./package.json`, so resolve the entry
    // point and read the manifest that sits above it.
    const entry = require.resolve('@heyphat/piner');
    const manifest = entry.replace(/dist[\\/].*$/, 'package.json');
    return (require(manifest) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Insertion-ordered LRU: a `get` re-inserts, so the oldest key is always the first one. */
class Lru<V> {
  private readonly entries = new Map<string, V>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const compiled = new Lru<CompiledScript>(MAX_COMPILED);
const results = new Lru<ExecuteResponse>(MAX_RESULTS);

function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Compilation depends on the source and the engine build — nothing else. */
export function compileKey(source: string): string {
  return digest([ENGINE_VERSION, source]);
}

/** Everything a run's output depends on. `dataset` is the window fingerprint, not the bars. */
export function resultKey(parts: {
  source: string;
  symbol: string;
  timeframe: string;
  dataset: string;
  inputs: unknown;
  strategy: unknown;
}): string {
  return digest([
    ENGINE_VERSION,
    parts.source,
    parts.symbol,
    parts.timeframe,
    parts.dataset,
    parts.inputs,
    parts.strategy,
  ]);
}

export const compileCache = {
  get: (key: string): CompiledScript | undefined => compiled.get(key),
  set: (key: string, value: CompiledScript): void => compiled.set(key, value),
};

export const resultCache = {
  get: (key: string): ExecuteResponse | undefined => results.get(key),
  set: (key: string, value: ExecuteResponse): void => results.set(key, value),
};

/** Test hook. */
export function clearCaches(): void {
  compiled.clear();
  results.clear();
}
