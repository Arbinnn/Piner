/**
 * The Pine backend.
 *
 * Two endpoints, no framework — `node:http` is enough for a JSON API this size, and it keeps
 * the deployable surface to one process with zero runtime dependencies beyond the engine.
 *
 *   GET  /api/candles?symbol=&timeframe=&bars=   OHLCV for the chart
 *   POST /api/pine/execute                       compile + run a script, return plot data
 *
 * In development Vite proxies `/api` here (see vite.config.ts), so the browser talks to one
 * origin and there is no CORS to configure.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatasetError, loadSymbol, recentBars } from './candles.ts';
import { PineFailure, executePine } from './pine/executor.ts';
import { validateExecuteRequest, ValidationError } from './validate.ts';
import type { CandlesResponse } from '../src/types/pine.ts';

const PORT = Number(process.env.PORT ?? 3001);
/** Generous for a Pine script, small enough that a runaway client cannot exhaust memory. */
const MAX_BODY_BYTES = 1_000_000;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, heading: string, message: string, line?: number, col?: number): void {
  sendJson(res, status, { error: { heading, message, ...(line !== undefined ? { line } : {}), ...(col !== undefined ? { col } : {}) } });
}

/** Reads a JSON body, refusing anything oversized or unparseable. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) throw new ValidationError('Request body is empty.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body is not valid JSON.');
  }
}

async function handleCandles(url: URL, res: ServerResponse): Promise<void> {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) throw new ValidationError('Query parameter `symbol` is required.');

  const barsParam = url.searchParams.get('bars');
  const bars = barsParam === null ? undefined : Number(barsParam);
  if (bars !== undefined && (!Number.isInteger(bars) || bars < 1)) {
    throw new ValidationError('Query parameter `bars` must be a positive integer.');
  }

  const candles = recentBars(await loadSymbol(symbol), bars);
  const payload: CandlesResponse = {
    symbol: symbol.toUpperCase(),
    timeframe: url.searchParams.get('timeframe') ?? 'D',
    candles: [...candles],
  };
  sendJson(res, 200, payload);
}

async function handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = validateExecuteRequest(await readJsonBody(req));
  sendJson(res, 200, await executePine(request));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/candles') return handleCandles(url, res);
  if (req.method === 'POST' && url.pathname === '/api/pine/execute') return handleExecute(req, res);
  if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true });

  if (url.pathname === '/api/candles' || url.pathname === '/api/pine/execute') {
    sendError(res, 405, 'Method Not Allowed', `${req.method} is not supported on ${url.pathname}.`);
    return;
  }
  sendError(res, 404, 'Not Found', `No route for ${url.pathname}.`);
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof ValidationError) {
      sendError(res, 400, 'Invalid Request', err.message);
      return;
    }
    if (err instanceof DatasetError) {
      sendError(res, err.status, 'Data Error', err.message);
      return;
    }
    if (err instanceof PineFailure) {
      sendError(res, err.status, err.pine.heading, err.pine.message, err.pine.line, err.pine.col);
      return;
    }
    // Anything else is a bug on this side. The client gets nothing but the fact that it broke:
    // stacks and engine internals stay in the server log.
    console.error('[pine] unhandled error', err);
    sendError(res, 500, 'Server Error', 'The execution service failed to handle the request.');
  });
});

server.listen(PORT, () => {
  console.log(`[pine] execution service listening on http://localhost:${PORT}`);
});
