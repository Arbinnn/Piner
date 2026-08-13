/**
 * The frontend's only route to Pine.
 *
 * No compiling, no engine, no indicator maths in the browser: this module posts a script to
 * the backend and hands back plot data ready for the renderer.
 */

import type { Candle } from '../types/candle';
import type { CandlesResponse, ExecuteRequest, ExecuteResponse, PineError } from '../types/pine';

const BASE = '/api';

/** A failure the console panel can render — a script error or a transport problem alike. */
export class PineApiError extends Error {
  readonly pine: PineError;

  constructor(pine: PineError) {
    super(pine.message);
    this.name = 'PineApiError';
    this.pine = pine;
  }
}

async function failureOf(res: Response): Promise<PineApiError> {
  try {
    const body: unknown = await res.json();
    const error = (body as { error?: PineError }).error;
    if (error && typeof error.message === 'string') return new PineApiError(error);
  } catch {
    // Fall through to the status-only message below.
  }
  return new PineApiError({ heading: 'Request Failed', message: `${res.status} ${res.statusText}` });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    throw new PineApiError({
      heading: 'Connection Failed',
      message: `Could not reach the execution service. Is it running? (${err instanceof Error ? err.message : String(err)})`,
    });
  }
  if (!res.ok) throw await failureOf(res);
  return (await res.json()) as T;
}

/** OHLCV for the chart. The same window the backend runs scripts over, so indices line up. */
export async function fetchCandles(symbol: string, timeframe: string, bars?: number): Promise<Candle[]> {
  const query = new URLSearchParams({ symbol, timeframe });
  if (bars !== undefined) query.set('bars', String(bars));
  const body = await request<CandlesResponse>(`/candles?${query.toString()}`);
  return body.candles;
}

/** Compiles and runs a script on the backend. Rejects with `PineApiError` on any failure. */
export function executePine(req: ExecuteRequest, signal?: AbortSignal): Promise<ExecuteResponse> {
  return request<ExecuteResponse>('/pine/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
}
