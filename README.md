# Piner

A TradingView-style Pine Script workbench: write a script, run it, see it plotted on
lightweight-charts, and backtest `strategy(...)` scripts in a full Strategy Tester.

**Pine Script never runs in the browser.** The editor posts the source to a Node backend, which
compiles it, executes it against the symbol's OHLCV and returns finished plot data. The frontend
only draws what it is given.

## Running it

Two processes:

```bash
npm install
npm run server   # Pine execution service on :3001
npm run dev      # Vite on :5173, proxying /api -> :3001
```

`PORT` overrides the backend port; `PINE_API_URL` points Vite's proxy somewhere else.

```bash
npm test         # node's test runner (engine + API)
npm run build    # tsc -b && vite build
npm run lint
```

## Architecture

```
Browser                          Node backend (server/)
  editor ── POST /api/pine/execute ──▶ validate  (validate.ts)
                                       compile   (pine/compiler.ts)   ← cached by source hash
                                       execute   (pine/runtime.ts)
                                       backtest  (strategy/executor.ts)
  chart  ◀──── plots / drawings ──────  serialize (src/types/pine.ts)  ← cached by full request
```

| Path | What lives there |
| --- | --- |
| `server/index.ts` | HTTP server and routes (`node:http`, no framework) |
| `server/validate.ts` | The trust boundary: every request field checked, unknown keys dropped |
| `server/candles.ts` | `server/data/<SYMBOL>.csv` -> parsed, cached OHLCV |
| `server/pine/` | compiler, runtime, execution service, compile + result caches |
| `server/strategy/` | the backtest: broker run, unsupported-feature scan |
| `src/types/pine.ts` | the API contract, and the only `Map` <-> JSON conversion |
| `src/lib/api.ts` | the frontend's only route to Pine |
| `src/lib/plotRenderer.ts` | draws a response onto lightweight-charts |

The dividing line: **anything that imports the piner engine lives under `server/`.** Pure
functions over the shared result types (`src/strategy/metrics.ts`, `strategyAdapter.ts`) stay in
`src/` because the dashboard uses them too — the server imports them from there.

Nothing but indicator output crosses the wire: no transpiled JavaScript, no compiled script, no
engine internals, no helper libraries. The browser bundle contains no Pine engine at all.

## API

### `POST /api/pine/execute`

```jsonc
{
  "script": "//@version=5\nindicator(\"MA\")\nplot(ta.sma(close, 20))",
  "symbol": "ADBL",
  "timeframe": "D",
  "inputs": { "Length": 20 },   // optional, input overrides
  "bars": 5000,                 // optional, most recent N bars
  "strategy": { "initialCapital": 50000 }  // optional, backtest overrides
}
```

Responds `200` with `{ meta, diagnostics, outputs, drawings, strategy, strategyConfig, range,
barCount, elapsedMs, cached }`. `outputs` is the plot/marker/fill/hline/background data keyed by
call-site id; `range` is the inclusive index window into the symbol's candles that the run
covered, so the client slices its own array to match.

Backtest settings layer as `piner defaults -> the script's strategy() header -> request
overrides`, so the client sends only the fields the user actually edited.

Errors come back as `{ "error": { "heading", "message", "line?", "col?" } }`:
`400` invalid request, `404` unknown symbol, `405` wrong method, `422` compile/runtime/backtest
failure, `500` a bug on the server (message is deliberately generic).

### `GET /api/candles?symbol=ADBL&timeframe=D&bars=5000`

`{ symbol, timeframe, candles }` — the same window `/execute` runs over, so indices line up.

## Caching and scaling

Two in-process LRUs, both keyed on a SHA-256 including the engine version: compiled scripts
(keyed on the source) and whole responses (source + symbol + timeframe + dataset fingerprint +
inputs + settings). The execution path is a plain async function over serializable data, so
moving it behind worker threads, Piscina or BullMQ — or swapping the LRUs for Redis — changes
neither the API nor the frontend.

## Adding a symbol

Drop `<SYMBOL>.csv` into `server/data/` with a `date,open,high,low,close,volume` header. Column
order is read from the header; blank lines and stray whitespace are tolerated.
