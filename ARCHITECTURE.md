# Piner — Architecture, Flow, Logic, and the TradingView Charting Library Migration

> Companion to [README.md](README.md). README is the "how do I run it" page; this is the
> "how does it actually work, and what has to change" page.

---

## 1. What the product is

A TradingView-style Pine Script workbench:

- Write Pine v5/v6 in a Monaco editor.
- Hit **Run**. The script is compiled and executed **on a Node backend**, never in the browser.
- Finished plot/drawing data comes back as JSON and is painted onto a chart.
- If the script is a `strategy(...)`, a full Strategy Tester dock renders the backtest
  (trades, equity curve, drawdowns, metrics, per-trade analysis).

Two processes, one origin:

| Process | Command | Port | Job |
|---|---|---|---|
| Backend | `npm run server` | 3001 | validate, compile, execute, backtest, cache |
| Frontend | `npm run dev` | 5173 | editor, chart, panels; proxies `/api` to 3001 |

`node --import ./scripts/register-ts.mjs` runs the TypeScript server directly — no build step
for the backend.

---

## 2. Hard architectural rule

**Anything that imports the `@heyphat/piner` engine lives under `server/`.**

The browser bundle contains no compiler, no runtime, no broker. `src/types/pine.ts` imports
piner types with `import type` only, so they are erased at build time. What crosses the wire is
plot arrays, drawing prop bags and backtest rows — nothing else.

Exception by design: pure functions over the *result* types
([src/strategy/metrics.ts](src/strategy/metrics.ts),
[src/strategy/strategyAdapter.ts](src/strategy/strategyAdapter.ts)) live in `src/` because the
dashboard needs them, and the **server imports them from there**. That is the only direction
`server/ → src/` dependency in the codebase, and it is deliberate.

---

## 3. Module map

### Backend (`server/`)

| File | Responsibility |
|---|---|
| [server/index.ts](server/index.ts) | `node:http` server. 3 routes, no framework. Maps thrown error classes to status codes. |
| [server/validate.ts](server/validate.ts) | The trust boundary. Every request field checked; unknown keys dropped. |
| [server/candles.ts](server/candles.ts) | CSV → `Candle[]` (epoch **seconds**), sorted + deduped, parsed once per process. Also `toPinerBars()` (seconds → **ms**) and `fingerprint()`. |
| [server/pine/compiler.ts](server/pine/compiler.ts) | Source → `CompiledScript`, plus three source rewrites (see §7). |
| [server/pine/runtime.ts](server/pine/runtime.ts) | The only place a piner `Engine` is constructed. Runs it, returns outputs/drawings/strategy report. Never throws. |
| [server/pine/executor.ts](server/pine/executor.ts) | The whole backend contract in one function: cache lookup → compile → indicator or strategy path → response. |
| [server/pine/cache.ts](server/pine/cache.ts) | Two in-process LRUs keyed on SHA-256 including engine version. |
| [server/strategy/executor.ts](server/strategy/executor.ts) | Backtest run + normalization into the shared strategy model. |
| [server/strategy/unsupported.ts](server/strategy/unsupported.ts) | Scan for strategy features the engine cannot honour, surfaced as warnings. |

### Shared contract

| File | Responsibility |
|---|---|
| [src/types/pine.ts](src/types/pine.ts) | `ExecuteRequest` / `ExecuteResponse`, and the **only** `Map ⇄ JSON` converters (`serializeOutputs` / `deserializeOutputs`). Both ends import this, so they cannot drift. |
| [src/types/candle.ts](src/types/candle.ts) | `Candle` — `time` is epoch **seconds**. |
| [src/strategy/types.ts](src/strategy/types.ts) | Normalized trade/equity/metrics model. |

### Frontend (`src/`)

| File | Responsibility |
|---|---|
| [src/App.tsx](src/App.tsx) | Layout + wiring. Hardcodes `SYMBOL = 'ADBL'`, `TIMEFRAME = 'D'`. |
| [src/lib/api.ts](src/lib/api.ts) | The only route to the backend. Wraps every failure in `PineApiError`. |
| [src/hooks/useCandles.ts](src/hooks/useCandles.ts) | `GET /api/candles` once per symbol/timeframe. |
| [src/hooks/useChart.ts](src/hooks/useChart.ts) | Chart instance lifecycle, base candle data, resize observer, one-time `fitContent()`. |
| [src/hooks/usePineScript.ts](src/hooks/usePineScript.ts) | The whole client pipeline: send script, draw response, keep panels in sync. |
| [src/hooks/useStrategy.ts](src/hooks/useStrategy.ts) | Backtest settings (as a **patch**, not a full config), result, visibility toggles, chart overlays. |
| [src/lib/plotRenderer.ts](src/lib/plotRenderer.ts) | **The renderer.** Reconciles a response onto lightweight-charts. 739 lines, the single largest coupling point. |
| [src/lib/drawings.ts](src/lib/drawings.ts), [fills.ts](src/lib/fills.ts), [backgrounds.ts](src/lib/backgrounds.ts), [tables.ts](src/lib/tables.ts) | Custom canvas primitives for everything lightweight-charts has no native concept of. |
| [src/lib/coords.ts](src/lib/coords.ts) | Fractional logical-index → pixel x. LWC only honours whole indices. |
| [src/components/strategy/*](src/components/strategy/) | The Strategy Tester dock: 18 components, mostly plain SVG/DOM. |

---

## 4. Request flow, end to end

```
mount
 └─ useCandles ──── GET /api/candles?symbol=ADBL&timeframe=D
                     └─ loadSymbol() parse+cache CSV → recentBars()
                     ← { symbol, timeframe, candles[] }        (time = epoch seconds)
 └─ useChart: createPineChart(), candleSeries.setData(candles), fitContent() ONCE

ready → usePineScript auto-runs once

Run click / input change / strategy-setting change
 └─ execute(fresh, overrides, inputs)
     └─ POST /api/pine/execute { script, symbol, timeframe, inputs, bars, strategy }
         ├─ validateExecuteRequest()          400 on anything malformed
         ├─ resultKey(...) → resultCache      hit ⇒ return { ...cached, cached: true }
         ├─ compileKey(source) → compileCache hit ⇒ reuse CompiledScript
         │    miss ⇒ rewriteShadowedColor(rewriteLegacyBuiltins(src)) → compile()
         │            + positionalOverlay() recovery
         ├─ isStrategy ? runStrategy() : runIndicator()
         │    └─ new Engine(compiled, ArrayFeed(bars)) ; engine.run()
         └─ serializeOutputs(collector) → WireOutputs
     ← { meta, diagnostics, outputs, drawings, strategy, strategyConfig, range, barCount,
         elapsedMs, cached }

     ├─ setTitle / setOverlay / setExecutedType
     ├─ toIndicatorInputs(meta.inputs, previous)  → inputs panel rebuilt, values carried over
     ├─ deserializeOutputs(response.outputs)      → Maps
     ├─ if (fresh) renderer.clear()
     ├─ renderer.render(outputs, drawings, candles.slice(range), meta.overlay, fresh)
     ├─ strategy ? strategy.apply(response) : strategy.clear()
     └─ if (!inputsHonored(sent, effective)) → one corrective re-run
```

### Logic worth knowing

- **`range` exists because the backend decides the window.** The client slices its own candle
  array to `[range.start, range.end]` so plot index `i` lines up with candle `i`. Every renderer
  loop is index-based, not time-based.
- **`fresh` vs re-run.** A Run tears the chart down (`clear()`) and may scroll to reveal
  off-screen drawings. An input/settings re-run must leave the user's zoom exactly where it is,
  so it reconciles in place.
- **`runSeqRef` guards races.** A stale response (seq mismatch) is dropped. Requests are not
  aborted — `AbortSignal` is plumbed into `executePine` but never passed.
- **Debounces.** Inputs 120 ms, strategy settings 150 ms.
- **Strategy settings are a patch.** The backend layers
  `piner defaults → strategy() header → user overrides`, so editing the script's declaration
  takes effect on the next run with zero client bookkeeping.
- **The corrective re-run.** The request has to be sent before the new input schema is known.
  If a carried-over override did not survive (e.g. an input changed kind), the chart could
  disagree with the panel, so exactly one extra round trip is issued — only when it happened.
- **Script type.** Guessed live from editor text (`detectPineScriptType`) so the Strategy Tester
  tab can appear before the first run; the backend's `meta.isStrategy` wins, but only for the
  exact source it described.

---

## 5. The renderer — where all the chart coupling lives

`PlotRenderer.render()` reconciles rather than rebuilds. Keys are `plot:<id>`, `plot:<id>#<run>`,
`candle:<id>`, `hline:<id>`, `panehost:<pane>`; anything not `seen` this pass is swept.

Order matters (z-stacking and host resolution):

```
syncPlots → syncCandles → syncBackground → syncFills → syncHlines → syncMarkers → syncDrawings → sweep
```

### Pane model

- Pane 0 = price (candles). Pane 1 = the indicator pane when `overlay = false`.
- `force_overlay = true` on a single output pins it to pane 0 even in a non-overlay script.
  `plotPanes` is resolved once so fills land on whichever pane their bounding plots went to.
- A pane needs a **host series** for price lines, markers and primitives. Preference:
  candle series (pane 0) → any visible plot on that pane → a synthetic transparent line series.
- A whitespace-only series never joins the price scale, so anything anchored to it silently
  fails to place. That is why `seedPaneHost()` fills the host with **real** values spanning
  `drawingsPriceExtent(drawings)` and declares the range via `autoscaleInfoProvider`.
- A hidden series suppresses its own price lines and primitives, hence
  `HOST_SERIES_OPTIONS` = "visible, fully transparent" rather than `visible: false`.

### Output kind → how it is drawn today

| Pine output | Mechanism |
|---|---|
| `plot()` | One `LineSeries`. Per-bar colours via `LineData.color`. |
| `plot(style=*br)` | **One series per contiguous run** — whitespace does not cut a line in LWC. |
| `plot(style=stepline*)` | `LineType.WithSteps`. |
| `plotcandle()` / `plotbar()` | `CandlestickSeries` with per-bar body/wick/border colours; `na` bars → whitespace. |
| `plotshape/plotchar/plotarrow` | `createSeriesMarkers` on the pane host. ~15 Pine shapes collapsed onto LWC's 4. |
| `hline()` | `host.createPriceLine()`. |
| `fill()` | Custom canvas primitive ([fills.ts](src/lib/fills.ts)). Run-batched polygons; gradient fills are one quad per bar pair with a per-bar `createLinearGradient`. |
| `bgcolor()` | Custom canvas primitive ([backgrounds.ts](src/lib/backgrounds.ts)), full-height bands, half-bar edge padding. |
| `box/line/label/polyline` | Custom canvas primitive ([drawings.ts](src/lib/drawings.ts)) — the visual output of most published indicators. |
| `table` | Canvas, screen-anchored, `zOrder: 'top'`, self-measuring grid ([tables.ts](src/lib/tables.ts)). |
| Strategy trades | A **second** markers plugin (`setStrategyMarkers`) so script markers and trade markers can be toggled independently. |
| Position tint | `setPositionBackground()` reuses the `bgcolor` primitive. |

### Coordinate logic

Everything custom-drawn goes through two conversions:

- `logicalToX(timeScale, logical)` — [coords.ts](src/lib/coords.ts). LWC's
  `logicalToCoordinate` returns 0 for a fractional index, so fractions are interpolated from
  `barSpacing`. Needed for mid-bar times, band edges at `i ± 0.5`, and drawings past the last bar.
- `series.priceToCoordinate(price)` — price → y, per pane.
- `timeToLogical(candles, timeMs)` — Pine `xloc.bar_time` values are epoch **ms**; binary search
  + interpolation + extrapolation past either end.

Fills and backgrounds clip to `getVisibleLogicalRange() ± 1` bar, so cost scales with the
viewport, not the dataset.

---

## 6. Strategy mode

```
response.strategy ─ useStrategy.apply()
  ├─ setConfigState(response.strategyConfig)     resolved settings echoed back
  ├─ setResult(...) ; status = 'success'
  └─ applyOverlays(result, visibility, selected)
        ├─ buildStrategyMarkers(trades, openPosition, visibility, selected)
        │     → SeriesMarker[] + Map<barTimeSeconds, MarkerInfo[]>
        ├─ renderer.setStrategyMarkers(markers)
        ├─ renderer.setPositionBackground(buildPositionBackground(directions))
        └─ setMarkersByTime(byTime)              ← consumed by StrategyChartTooltip
```

- `StrategyChartTooltip` subscribes to `subscribeCrosshairMove` and looks the hovered **bar**
  up in `markersByTime` — hovering anywhere on the bar works, not just the arrow pixels.
- Selecting a trade calls `timeScale().setVisibleLogicalRange({from: entry-12, to: exit+12})`.
- `visibility.plots` mutes every script plot without a re-run (`setPlotsVisible`).
- The equity / drawdown / benchmark curves use a **second, read-only lightweight-charts
  instance** ([StrategyMiniChart.tsx](src/components/strategy/StrategyMiniChart.tsx)).
  Everything categorical is hand-rolled SVG ([SvgCharts.tsx](src/components/strategy/SvgCharts.tsx)).

---

## 7. Compatibility register — every fix made because a script rendered wrong

This is the accumulated "why doesn't this indicator work" knowledge, in one place. Almost every
entry fixes a **silent** failure: the script compiled clean, ran without error, and drew
something wrong or nothing at all. None of them are cosmetic, and none are obvious from the code
they sit in — which is why they are listed rather than left as comments.

Column **TV** = does the fix survive the TradingView Charting Library migration (Part II)?
`keep` = still needed as-is · `port` = same problem, new mechanism · `moot` = the library
handles it · `redo` = must be re-solved from scratch, see §16.

### 7.1 Compile stage — [server/pine/compiler.ts](server/pine/compiler.ts)

| Fix | Symptom it cures | TV |
|---|---|---|
| **`positionalOverlay()`** — recovers `overlay` passed positionally | `compile()` reads only named `overlay=`, so `indicator("T","S",true)` compiled as `overlay:false`, landed on pane 1, and every plot/drawing silently failed to place. Blank chart, no error. | keep |
| **`rewriteLegacyBuiltins()`** — bare v3/v4 builtins → `math.*` / `ta.*` | Unresolved calls are **not** a compile error in piner — they evaluate to `na` every bar. A v4 ADX/DI strategy on bare `rma`/`tr`/`crossover` compiled clean with every plot and every entry condition dead. Rewritten in place, columns preserved so diagnostics still land right. | keep |
| **`rewriteShadowedColor()`** — renames a user variable named `color` | The symbol resolver checks locals before namespaces, so one `color = trend ? a : b` made every later `color.new(...)` resolve against the variable → `na` → a script that renders with no colours at all. Replacement is the same length, so diagnostic columns are untouched. | keep |
| **`rewriteStudyToIndicator()`** — v3/v4 `study(...)` → `indicator(...)` | The engine knows only `indicator`/`strategy`; an unrecognized declaration is not an error, it just does nothing — discarding the **entire header at once**. Title became `""`, `overlay` defaulted to false (an overlay script landed on a separate pane), and `max_lines_count` / `max_labels_count` / `max_boxes_count` fell back to Pine's default of **50**. LuxAlgo's Volume Profile declares `max_lines_count=500` and draws 201 lines; unrewritten it produced 50, unnamed, on the wrong pane. The two declarations share their first three positional parameters, so the swap is safe. `positionalOverlay()` now reads the **patched** source, since `study` is only a recognizable declaration afterwards. | keep |

### 7.2 Strategy correctness

| Fix | Symptom it cures | Where | TV |
|---|---|---|---|
| **`findUnsupportedStrategyCalls()`** refuses to run | An unknown `strategy.*` member is not a compile error — it evaluates to `undefined` and the call no-ops. The user got a clean, plausible backtest that had quietly ignored half their orders. Now the run is refused with the member names and lines. | [unsupported.ts](server/strategy/unsupported.ts) | keep |
| Supported members read **off the runtime namespace** (`Object.keys(new ExecutionContext().strategy)`) | A hand-written allow-list drifts the moment piner is upgraded — either rejecting features that now work or accepting ones that never did. | [unsupported.ts:17](server/strategy/unsupported.ts#L17) | keep |
| **`readOpenLots()`** via `strategy.opentrades_*` | `StrategyReport` carries only CLOSED trades. An open position at the last bar was invisible in the dashboard, or worse got counted as completed. Read through the same accessors Pine itself uses, so numbers match the script's view. | [runtime.ts:87](server/pine/runtime.ts#L87) | keep |
| Open P&L marked against the **final bar's close** | Once the run ends, the broker's live-close mark no longer refers to that bar. Marking here keeps it consistent with the equity curve's last point. | [strategyAdapter.ts:78](src/strategy/strategyAdapter.ts#L78) | keep |
| Unwritten equity slots carry the **last known** equity | piner leaves pre-activation bars unwritten; reading them raw punched holes in the curve down at initial capital. | [strategyAdapter.ts:147](src/strategy/strategyAdapter.ts#L147) | keep |
| Benchmark basis = **first closed trade's entry fill** | Any other basis makes the buy-&-hold LINE disagree with the reported `buyHoldReturnPercent`. Falls back to bar 1's open — where a bar-0 signal would actually have filled. | [strategyAdapter.ts:177](src/strategy/strategyAdapter.ts#L177) | keep |
| Flat-state snap at `qty < 1e-9` | The O(bars+lots) difference sweep drifts in float, so `direction` read `'long'` at a size of 1e-13 and the position tint never turned off. | [strategyAdapter.ts:242](src/strategy/strategyAdapter.ts#L242) | keep |
| Difference sweep instead of per-bar lot scan | Naive scanning is O(bars × lots) and stalls once a strategy produces tens of thousands of lots. | [strategyAdapter.ts:200](src/strategy/strategyAdapter.ts#L200) | keep |
| Metrics divide → `null`, never `NaN`/`Infinity` | "Not computable" (no losing trades, zero denominator) rendered as `NaN` or `∞` in the dashboard instead of an honest dash. | [metrics.ts:41](src/strategy/metrics.ts#L41) | keep |
| Gross = `profit + commission` | piner books `profit` NET of both sides' fee; reporting it as gross double-counted the commission line. | [strategyAdapter.ts:44](src/strategy/strategyAdapter.ts#L44) | keep |
| **"Not a Strategy"** guard | An `indicator()` script reaching the strategy path produced an empty result with no explanation. | [executor.ts:110](server/strategy/executor.ts#L110) | keep |
| Empty date-range guard | An over-narrow `from`/`to` yielded zero bars and an unexplained failure; now it says to widen the range. | [executor.ts:70](server/strategy/executor.ts#L70) | keep |

### 7.3 Inputs

| Fix | Symptom it cures | Where | TV |
|---|---|---|---|
| **Omit inputs whose default piner could not report**, while untouched | Sending the UI placeholder instead overrode e.g. `input.source(close)` with `''`, which the engine then used as the series — turning every downstream calculation into `na`. The single nastiest input bug in the project. | [inputSchema.ts:70](src/lib/inputSchema.ts#L70) | keep |
| Carry a previous value over when **key + kind** still match | Otherwise every Run after an unrelated edit reset every control the user had touched. | [inputSchema.ts:23](src/lib/inputSchema.ts#L23) | keep |
| Inferred labels for untitled inputs | Scripts pass `''` as the title and rely on Pine's `inline` to sit the control beside a labelled sibling (LuxAlgo colour swatches). piner's schema carries no `inline`, so the row cannot be rebuilt — naming them after the preceding labelled input at least keeps them identifiable instead of a column of anonymous controls. | [inputSchema.ts:43](src/lib/inputSchema.ts#L43) | keep |
| `defaultValueOf()` coerces a `null` default per kind | `null` reached the controls as an uncontrolled-input React warning and an unusable field. | [inputSchema.ts:5](src/lib/inputSchema.ts#L5) | keep |
| **`inputsHonored()`** corrective re-run | The request must be sent before the new input schema is known. If an override did not survive (input changed kind), the chart silently disagreed with the panel. Exactly one extra round trip, only when it actually happened. | [usePineScript.ts:66](src/hooks/usePineScript.ts#L66) | keep |

### 7.4 Renderer / pane model — [src/lib/plotRenderer.ts](src/lib/plotRenderer.ts)

| Fix | Symptom it cures | TV |
|---|---|---|
| **`BREAK_ON_NA_STYLES`** → one series per contiguous run | LWC drops whitespace before it reaches the series, then joins whatever points remain. A two-state regime indicator (one plot per regime, `na` where the other is live) drew both lines full-width, overlapping, instead of handing off. | moot — return `NaN` from `main()` |
| **`force_overlay`** honoured per output | Pine v6's escape hatch. An oscillator that also marks price-level zones had those price-scaled outputs land in the oscillator pane, invisible at a wildly wrong scale, wrecking the pane's autoscale too. | port |
| Fills follow their **bounding plots'** pane | Otherwise a `force_overlay` plot pair left its fill orphaned on the wrong pane. | port |
| **Host series is visible-but-transparent**, not `visible: false` | LWC suppresses a series' price lines and marker primitives along with the series. `visible:false` was tried first and rejected. | moot |
| Pane host prefers a **visible plot carrying real data** | A whitespace-only series never joins the pane's price scale, and anything anchored to a scale-less series silently fails to place. | moot |
| **`seedPaneHost()`** + `autoscaleInfoProvider` from `drawingsPriceExtent` | A pane holding only drawings (a gauge built from polylines, no `plot()` anywhere) had nothing to give its price scale a range, so every drawing on it silently failed to place. | redo |
| Zero-height extent padded by 1 | A flat extent gives LWC nothing to scale against. | redo |
| **All marker series on a pane share ONE plugin** bound to the real host | The earlier per-marker transparent whitespace host meant LWC had no price to anchor to and every marker silently failed to draw. | port |
| Markers sorted ascending by time | LWC requirement; unsorted input drops markers. | port |
| **`MARKER_SHAPES`** maps ~15 Pine shapes onto LWC's 4, preserving up/down sense | A `shape.labelup` buy marker must not end up identical to a `shape.labeldown` sell marker. Unknown glyphs fall back to the direction the *location* implies. | port |
| `plotchar` glyph used as text when none given | The glyph IS the visible content of a `plotchar`; without this the marker rendered blank. | port |
| **Strategy markers get their own plugin** | `syncMarkers` is rewritten on every re-run from the script's own `plotshape` output; sharing one plugin made script markers and trade markers erase each other. | moot — `createExecutionShape` |
| **`revealDrawings()`** scrolls right on a fresh Run only | Profile-style scripts draw tens of bars past the last candle, outside the default view — the output looked missing. Window width is preserved; stretching `to` instead squeezed all history into the same pixels and shrank the profile to a sliver. A re-run never does this, so the user's zoom is never disturbed. | port |
| `ensurePaneHeight()` only when something landed in pane 1 | A script whose every plot is `force_overlay` otherwise grew an empty pane. | port |
| Key/sweep reconciliation instead of teardown | Repeated Run clicks duplicated every series; input-driven re-runs flickered. | port |
| `setPlotsVisible()` respects each plot's own `display` | The Strategy Tester's global mute must not un-hide a plot the script itself hid. | port |
| `plotcandle` `na` bars → whitespace, not a zeroed candle | A zeroed OHLC bar drew a candle crushed at the bottom of the scale. | port |
| `NaN`/`Infinity` → `null` over JSON; every consumer gates on `Number.isFinite` | `JSON.stringify` cannot carry `NaN`, so `na` gaps would have been lost in the round trip. | keep |

### 7.5 Drawings, fills, backgrounds, tables

| Fix | Symptom it cures | Where | TV |
|---|---|---|---|
| **`isNa()`** distinguishes explicit Pine `na` from an absent prop | Omitting `color` means "use the default"; `color = na` means "do not paint". Collapsing the two made every switched-off drawing (`color = showSignal ? Up : na`) render in fallback grey instead of disappearing. | [drawings.ts:37](src/lib/drawings.ts#L37) | keep |
| Box **text** rendering, clipped, with min-size thresholds | Volume-profile scripts put their whole readout in box text — without it, an unreadable stack of bars. Too-small boxes drop the text rather than smearing it, which is what TradingView does. | [drawings.ts:261](src/lib/drawings.ts#L261) | redo |
| **`SHAPE_STYLES`** — marker-style labels carrying no text | A volume-bubble script sets `text = ""` and varies `size`; these were being skipped as empty labels and drew nothing. | [drawings.ts:65](src/lib/drawings.ts#L65) | port |
| Separate `SHAPE_RADIUS_PX` scale | TradingView's bubbles run visibly larger than text of the same `size.*` name; reusing the text scale made them look wrong. | [drawings.ts:80](src/lib/drawings.ts#L80) | redo |
| Near-zero `dx` guard on extended lines | Pine's own hlines arrive as `x2 = x1 + 1ms`; the slope blew up and the line shot off-screen. | [drawings.ts:313](src/lib/drawings.ts#L313) | moot |
| Polyline skips unplaceable points instead of truncating | Scripts routinely push `na` into a polyline's warm-up; truncating cut the whole path. | [drawings.ts:354](src/lib/drawings.ts#L354) | port |
| Midpoint-quadratic smoothing for `curved` polylines | Not TradingView's exact spline, but indistinguishable at one-point-per-bar density. | [drawings.ts:365](src/lib/drawings.ts#L365) | redo |
| Label body placed **opposite** the pointer | `label_left` points left and its body extends right; getting this backwards put every callout on the wrong side of its anchor. | [drawings.ts:411](src/lib/drawings.ts#L411) | port |
| **`timeToLogical()`** interpolates *and* extrapolates past both ends | `xloc.bar_time` values that fall between bars, or beyond the last one, otherwise failed to place. | [drawings.ts:490](src/lib/drawings.ts#L490) | moot |
| Tables at `zOrder: 'top'`, screen-anchored, skipped when larger than the pane | Tables are chrome, not chart geometry — they must never move with price/time, and an oversized one would cover the entire chart. | [tables.ts:44](src/lib/tables.ts#L44) | redo — DOM |
| Fill boundary may be an **hline**, not just a plot | `fill()` between two `hline()`s is the standard way to shade an RSI band; hline boundaries were being dropped as unresolvable. | [fills.ts:60](src/lib/fills.ts#L60) | port |
| Boundaries read from **data**, not from the series | Gradient-fill scripts hide their helper plots with `display.none`; reading the series meant the entire shaded body vanished while the line still drew. | [fills.ts:96](src/lib/fills.ts#L96) | port |
| Gradient fills detected separately in `resolveFills` | A gradient fill carries its colours in `gradient` and leaves `color`/`colors` empty, so the "no colour ⇒ switched off" test discarded it. | [fills.ts:81](src/lib/fills.ts#L81) | redo |
| **`fadeOut()`** — missing gradient end becomes the other end's hue at zero alpha | Canvas interpolates stops in non-premultiplied sRGB, so fading to `rgba(0,0,0,0)` dragged the midpoint through grey and left a dirty smear. | [fills.ts:49](src/lib/fills.ts#L49) | redo |
| Half-pixel overlap between gradient quads | Adjacent translucent paths that meet exactly leave antialiased hairlines, which read as vertical banding across the fill. | [fills.ts:266](src/lib/fills.ts#L266) | redo |
| Colour-run batching flushes **on** the changing bar (`flush(i+1)`) | Closing the run one bar early left a visible seam between the two polygons. | [fills.ts:216](src/lib/fills.ts#L216) | moot |
| Background bands drawn at `i ± 0.5` bar edges | Bar-centred rectangles left gaps, so a tinted stretch looked striped instead of continuous. | [backgrounds.ts:74](src/lib/backgrounds.ts#L74) | moot |
| Fills/backgrounds clip to the visible range ± 1 bar | Cost scales with the viewport, not the dataset. | [fills.ts:140](src/lib/fills.ts#L140) | moot |
| **`logicalToX()`** interpolates fractional indices | `logicalToCoordinate` returns 0 — not a mid-bar x — for anything fractional, so band edges, mid-bar times and past-the-end drawings all collapsed to x=0. | [coords.ts:11](src/lib/coords.ts#L11) | moot |

### 7.6 Diagnostics and UX safety nets

| Fix | Symptom it cures | Where | TV |
|---|---|---|---|
| **`warnIfBlank()`** | A script whose every plot is `display.none` and which draws nothing renders an empty chart despite running correctly — the console now says so instead of leaving it a mystery. | [usePineScript.ts:152](src/hooks/usePineScript.ts#L152) | keep |
| `runSeqRef` stale-response drop | Fast successive runs could paint an older result over a newer one. | [usePineScript.ts:186](src/hooks/usePineScript.ts#L186) | keep |
| Strategy mode marked from **editor text** before the response lands | Otherwise the tester panel only showed "running" for the tail of the round trip. | [usePineScript.ts:191](src/hooks/usePineScript.ts#L191) | keep |
| `fitContent()` exactly once | Re-fitting on every run threw away the user's zoom and scroll. | [useChart.ts:62](src/hooks/useChart.ts#L62) | port |
| Failed dataset loads evicted from the cache | One bad read otherwise poisoned the symbol until process restart. | [candles.ts:129](server/candles.ts#L129) | keep |
| 500s return a generic message | Stacks and engine internals stay in the server log, never on the wire. | [index.ts:113](server/index.ts#L113) | keep |

### 7.7 What this means for the migration

Of ~55 fixes: roughly **30 are backend or model-level and migrate untouched**, ~15 need the same
idea expressed through a different API, and **~10 are canvas-specific and must be re-solved**
(marked `redo`): gradient fill handling, box text, plot-less pane scaling, shape sizing, curved
polylines, and the Pine `table`. Those ten are the real content of Part II phase 4 and §16 —
not the plotting, which is the easy part.

---

## 8. Caching, errors, safety

**Caching.** Compile cache keyed on `[engineVersion, source]` (50 entries). Result cache keyed on
`[engineVersion, source, symbol, timeframe, datasetFingerprint, inputs, strategyOverrides]`
(40 entries). Cached responses set `cached: true`, `elapsedMs: 0`.

**Error mapping** ([server/index.ts](server/index.ts)):

| Class | Status | Shown as |
|---|---|---|
| `ValidationError` | 400 | Invalid Request |
| `DatasetError` | 404 / 400 / 422 | Data Error |
| `PineFailure` | 422 | Compilation / Runtime / Strategy Error, with `line`/`col` |
| anything else | 500 | deliberately generic; stack stays in the server log |

**Safety.** 1 MB body cap; `SYMBOL_PATTERN` prevents path traversal into `server/data/`; failed
dataset loads are evicted so one bad read cannot poison a symbol; `runScript` never throws.

---

## 9. Known gaps / debt (independent of any chart migration)

| # | Item | Where |
|---|---|---|
| 1 | Symbol and timeframe are hardcoded constants; no picker, no multi-symbol UI. | [src/App.tsx:17-18](src/App.tsx#L17-L18) |
| 2 | In-flight requests are never aborted — only sequence-guarded. `signal` is plumbed but unused. | [src/lib/api.ts:58](src/lib/api.ts#L58), [usePineScript.ts:186](src/hooks/usePineScript.ts#L186) |
| 3 | `bars` is always `candles.length`, so the `bars` cap is dead weight in practice. | [usePineScript.ts:201](src/hooks/usePineScript.ts#L201) |
| 4 | `StrategyConfig.from` / `to` (backtest window) exist in the model but nothing sends them. | [src/strategy/types.ts:39-40](src/strategy/types.ts#L39-L40) |
| 5 | Duplicate dataset: `ADBL.csv` at repo root **and** `server/data/ADBL.csv`. Only the second is read. | root |
| 6 | Empty `Piner/` directory tracked at root. | root |
| 7 | Zero tests for the renderer/primitives — the most fragile code has the least coverage. Tests cover engine + API only. | `src/**/*.test.ts` |
| 8 | `linefill` is unimplemented (documented TODO in `drawOne`). | [src/lib/drawings.ts:118](src/lib/drawings.ts#L118) |
| 9 | Server is single-process, in-memory-cached. Horizontal scale needs the LRUs swapped for Redis (the execution path is already a plain async function over serializable data). | [server/pine/cache.ts](server/pine/cache.ts) |
| 10 | `*br` plots create one series per run — fine at tens of flips, pathological at thousands. | [plotRenderer.ts:116](src/lib/plotRenderer.ts#L116) |

---

# Part II — Migrating to the TradingView Charting Library

## 10. What you are actually switching to

**Lightweight Charts** (current, v5.2.0) is an npm package, ~50 KB, that gives you a canvas and
an escape hatch (`ISeriesPrimitive`) to draw whatever you want on it.

**TradingView Charting Library** (a.k.a. Advanced Charts) is a different product:

- **Not on npm.** Access is granted to a private GitHub repo (`tradingview/charting_library`)
  after you apply at <https://www.tradingview.com/advanced-charts/>. Licence forbids
  redistribution; the files get copied into your app, not installed.
- Shipped as a prebuilt bundle you host yourself: `charting_library/` (+ `datafeeds/` samples).
  Loaded via `<script src="/charting_library/charting_library.standalone.js">`, exposing
  `window.TradingView.widget`. Types come from `charting_library.d.ts`.
- Renders inside an **iframe** it creates in your container. You talk to it through the widget
  API, not the DOM.
- You get the whole TradingView chart UI for free: symbol search, timeframe bar, the full drawing
  toolbar, indicator dialog, chart settings, saved layouts, replay.

**The consequence that decides your whole plan:** the Charting Library has **no public canvas
primitive API and no public price/time → pixel conversion**. `attachPrimitive`,
`priceToCoordinate`, `logicalToCoordinate` — the foundation of
[drawings.ts](src/lib/drawings.ts), [fills.ts](src/lib/fills.ts),
[backgrounds.ts](src/lib/backgrounds.ts), [tables.ts](src/lib/tables.ts) and
[coords.ts](src/lib/coords.ts) — do not exist there.

You express custom rendering through exactly three sanctioned channels:

1. **Datafeed** (`getBars`, `resolveSymbol`, `subscribeBars`, optional `getMarks`) — the bars.
2. **Custom indicators** (`custom_indicators_getter` + PineJS study definitions) — plots,
   per-bar colours, fills between plots, background colouring, shape/char markers, bands.
3. **Shapes API** (`createShape`, `createMultipointShape`, `createExecutionShape`) — discrete
   drawing objects, one entity at a time.

## 11. Capability mapping

| Piner output | Today (LWC) | Charting Library | Fidelity |
|---|---|---|---|
| Candles | `CandlestickSeries.setData` | Datafeed `getBars` | ✅ same |
| `plot()` | `LineSeries` | study plot `type: 'line'` | ✅ same |
| Per-bar plot colour | `LineData.color` | `colorer` plot + `palette` | ⚠️ palette is a **fixed enumerated set**, not free colours — needs a per-run palette built from the distinct colours in the array |
| `*br` gaps | one series per run | return `NaN` from `main()` | ✅ **better** — native gap, no series explosion |
| stepline | `LineType.WithSteps` | `plottype: 'step_line'` | ✅ same |
| `plotcandle` | `CandlestickSeries` | `ohlc` plot group + colorer | ✅ close |
| markers | `createSeriesMarkers` | `shapes`/`chars` plot, or datafeed `getMarks` | ⚠️ different glyph set; `chars` renders arbitrary text |
| `hline()` | `createPriceLine` | study `bands` in metainfo | ✅ close |
| `fill()` flat | canvas primitive | `filledAreas` in metainfo | ✅ **native** |
| `fill()` gradient | per-bar canvas gradient | — | ❌ **no equivalent** |
| `bgcolor()` | canvas primitive | `bg_colorer` plot + palette | ✅ native (palette-limited) |
| `box` | canvas | `createMultipointShape(..., 'rectangle')` | ⚠️ one entity each; hundreds OK, thousands not |
| `line` | canvas | `createMultipointShape(..., 'trend_line')` | ⚠️ same |
| `label` | canvas | `createShape(..., 'text'/'balloon'/arrow shapes)` | ⚠️ same |
| `polyline` | canvas path | `'polyline'` / `'curve'` shape | ⚠️ heavy; curved smoothing differs |
| `table` | canvas, screen-anchored | — | ❌ **must become a DOM overlay div** outside the iframe |
| `extend = right/both` | pixel extrapolation | shape `extendRight`/`extendLeft` overrides | ✅ close |
| Strategy trade markers | second markers plugin | `createExecutionShape()` (has native tooltip + text) | ✅ **better** |
| Position tint | `bgcolor` primitive | a second `bg_colorer` study | ✅ close |
| Marker hover tooltip | custom React card on `subscribeCrosshairMove` | `ExecutionShape.setTooltip()` | ✅ **simpler** |
| Mini equity chart | second LWC instance | keep LWC, or a second CL widget | 🟡 keep LWC — it costs nothing |
| Theme swap | `applyOptions` | `widget.changeTheme()` + `overrides` | ✅ same |
| Trade focus scroll | `setVisibleLogicalRange` | `chart.setVisibleRange({from,to})` (**times**, not indices) | ⚠️ rework |

## 12. Unit and identity gotchas (these will bite)

| Thing | LWC | Charting Library |
|---|---|---|
| Datafeed bar `time` | seconds | **milliseconds** |
| Study `ctx.symbol.time` | — | **milliseconds** |
| `createShape` point `time` | — | **seconds** (snaps to nearest bar) |
| `getMarks` `time` | — | **seconds** |
| Resolution string | `'D'` (yours, free-form) | `'1D'` (must match `supported_resolutions`) |
| Bar addressing | logical index | time only — **no public index API** |
| Instance lifetime | `createChart` / `chart.remove()` | `new widget(...)`, `onChartReady()`, `widget.remove()` |

**The index problem is the structural one.** Every piner output is an array indexed by bar
position. The Charting Library addresses everything by time. So the bridge is a single
`Map<timeMs, index>` built once per run from the executed candle window, consulted inside
`main()` and when placing shapes.

## 13. Recommended architecture

Do **not** try to port the canvas primitives — there is nowhere to attach them. Instead:

```
ExecuteResponse
   │
   ├─ candles ──────────────► Datafeed.getBars()        (already have /api/candles)
   │
   ├─ outputs.plots
   │  outputs.fills          ┐
   │  outputs.hlines         ├─► ONE generated custom study, "Piner Output"
   │  outputs.markers        │   fed from a module-level store, indexed by bar time
   │  outputs.bgColors       ┘
   │
   ├─ drawings (box/line/label/polyline) ──► createShape / createMultipointShape
   ├─ drawings (table) ─────────────────────► React DOM overlay, absolutely positioned
   └─ strategy.trades ──────────────────────► createExecutionShape
```

The study is a **data courier, not a calculation**. Its `main()` does no maths:

```ts
// public/piner-study.ts (sketch)
const store = { byTime: new Map<number, number>(), plots: [] as (number|null)[][] };

constructor: function () {
  this.main = function (ctx) {
    this._context = ctx;
    const i = store.byTime.get(ctx.symbol.time);          // ms → bar index
    if (i === undefined) return store.plots.map(() => NaN);
    return store.plots.map((p) => p[i] ?? NaN);           // NaN = native gap
  };
}
```

Because `metainfo` (plot count, fills, palettes, bands) is fixed at study-registration time and
each script produces a different shape, the metainfo has to be **generated per run** from
`ExecuteResponse.meta` + `outputs`. Two options:

- **(a) Regenerate + re-register**: build metainfo, `chart.removeEntity(prevStudyId)`, then
  `chart.createStudy(...)`. `custom_indicators_getter` is consulted once at widget init, so this
  means either re-creating the widget on shape change or registering a generous fixed superset.
- **(b) Fixed superset** *(recommended)*: register one study with, say, 16 line plots, 16
  colorers, 8 filled areas, 4 bg colorers, 8 shape plots, all `display: none` by default, then
  use `study.setInputs()` / style overrides per run to reveal and colour only what the script
  actually produced. Ugly metainfo, but one registration and no widget churn.

Option (b) is the lazy path that works. Start there; only reach for (a) if a script exceeds the
superset.

## 14. File-by-file change list

### New

| File | Purpose | Rough size |
|---|---|---|
| `public/charting_library/**` | The vendored library (gitignored, licence-restricted). | vendor |
| `src/lib/tv/datafeed.ts` | `IBasicDataFeed` over the existing `/api/candles`: `onReady`, `resolveSymbol`, `getBars` (seconds→ms, `countBack` slicing, `noData`), no-op `subscribeBars`. | ~120 |
| `src/lib/tv/studyMetainfo.ts` | Builds the superset study metainfo + palettes. | ~250 |
| `src/lib/tv/studyStore.ts` | Module-level mutable store + `byTime` index the study reads. | ~40 |
| `src/lib/tv/tvRenderer.ts` | The `PlotRenderer` counterpart: writes the store, applies style overrides, diffs and reconciles shape entities. | ~400 |
| `src/lib/tv/shapes.ts` | `DrawObject` → `createShape`/`createMultipointShape` args, with an entity-id diff so re-runs do not orphan shapes. | ~200 |
| `src/components/TableOverlay.tsx` | Pine `table` as absolutely-positioned DOM over the widget. | ~80 |
| `src/hooks/useTvChart.ts` | Widget lifecycle: construct, `onChartReady`, theme, `remove()`. | ~90 |

### Modified

| File | Change |
|---|---|
| [index.html](index.html) | `<script src="/charting_library/charting_library.standalone.js">` before the module script. |
| [src/types/candle.ts](src/types/candle.ts) | Drop the `UTCTimestamp` import — `type UTCTimestamp = number & { _brand: 'utc' }` locally, or just `number`. Removes LWC from the shared contract entirely. |
| [src/App.tsx](src/App.tsx) | Swap `useChart` → `useTvChart`; mount `TableOverlay`. |
| [src/hooks/usePineScript.ts](src/hooks/usePineScript.ts) | Type of `chartRef`/`rendererRef` only; the pipeline is unchanged. |
| [src/hooks/useStrategy.ts](src/hooks/useStrategy.ts) | `setVisibleLogicalRange({from: idx, to: idx})` → `chart.setVisibleRange({from: time, to: time})` using bar **times**, and `FOCUS_PADDING_BARS` becomes a time span. |
| [src/strategy/markers.ts](src/strategy/markers.ts) | `SeriesMarker[]` → `createExecutionShape` descriptors; the `byTime` map survives unchanged. |
| [src/components/strategy/StrategyChartTooltip.tsx](src/components/strategy/StrategyChartTooltip.tsx) | Delete, or keep for the non-trade markers; execution shapes carry their own tooltip. |
| [src/lib/chart.ts](src/lib/chart.ts) | `THEMES` stays (the Strategy Tester reads `THEME.*`); `createPineChart`/`applyChartTheme` become widget `overrides` builders. |
| `.gitignore` | `public/charting_library/`, `public/datafeeds/`. |
| [vite.config.ts](vite.config.ts) | Nothing required — `public/` is copied verbatim. |
| [README.md](README.md) | Vendoring instructions; the library is not `npm install`-able. |

### Deleted (if you fully commit)

[src/lib/drawings.ts](src/lib/drawings.ts) · [src/lib/fills.ts](src/lib/fills.ts) ·
[src/lib/backgrounds.ts](src/lib/backgrounds.ts) · [src/lib/coords.ts](src/lib/coords.ts) ·
most of [src/lib/plotRenderer.ts](src/lib/plotRenderer.ts).
[src/lib/tables.ts](src/lib/tables.ts) survives in spirit as DOM.
That is roughly **1,800 lines out, ~1,200 lines in** — and the ~1,200 is easier code.

### Untouched

**The entire backend.** `server/**` needs zero changes. The wire contract, the caches, the
compiler workarounds, the strategy model, the metrics, every Strategy Tester panel except the
tooltip — all independent of which chart draws the result. That is the payoff of the
"frontend only draws what it is given" rule.

## 15. Phased plan

| Phase | Deliverable | Exit test |
|---|---|---|
| 0 | Get repo access; vendor `charting_library/`; `.gitignore`; hello-world widget beside the existing chart. | Widget renders. |
| 1 | Datafeed over `/api/candles`. `resolveSymbol` → `{session:'24x7', timezone:'Etc/UTC', minmov:1, pricescale:100, has_intraday:false, supported_resolutions:['1D']}`. | ADBL candles identical to the LWC chart. |
| 2 | Superset study + store. Wire `outputs.plots` only. | Default MA script plots correctly, colours and gaps right. |
| 3 | `filledAreas`, `bands`, `bg_colorer`, shape/char plots. | RSI-with-bands and a `bgcolor` regime script match the LWC render. |
| 4 | Shapes for `box`/`line`/`label`/`polyline` + entity diffing. | An order-block / volume-profile script renders; a re-run does not orphan shapes. |
| 5 | Strategy: `createExecutionShape`, position-tint study, trade focus by time. | Strategy Tester behaves as today. |
| 6 | Table DOM overlay; theme sync; delete dead code; update README. | Full parity sweep across the script corpus. |

**Run both engines side by side through phase 5.** One env flag, one branch in `App.tsx`:

```ts
const useTv = import.meta.env.VITE_CHART_ENGINE === 'tv';
```

Cheaper than a big-bang cutover, and it is how you compare renders script-by-script. Delete the
LWC path only once you are satisfied — remember it still powers
[StrategyMiniChart.tsx](src/components/strategy/StrategyMiniChart.tsx), so
`lightweight-charts` probably stays in `package.json` either way.

## 16. Decisions to make before phase 2

> Every item below is a fix from §7 marked `redo` — a problem already solved once on canvas that
> the Charting Library gives you no direct way to solve again. Re-read §7.5 before deciding.


1. **Gradient fills.** No Charting Library equivalent. Options: approximate with N stacked
   `filledAreas` at stepped opacities, drop them (log a warning), or keep an LWC render mode for
   scripts that use them. Recommendation: **approximate with 3–5 bands**, warn in the console.
2. **Palette size.** `colorer` plots enumerate colours up front. A script with continuous
   per-bar colour (a heatmap) needs quantizing to N buckets. Pick N (16 is a sane default).
3. **Shape budget.** Set a hard cap (e.g. 2,000 entities), render the newest N, and warn. A
   volume-profile script emitting 5,000 boxes will visibly stall the widget where the canvas
   primitive did not.
4. **Superset dimensions.** How many plots / fills / shape channels the fixed metainfo carries.
   Scan the script corpus you care about and take the max plus headroom.
5. **Do you want TradingView's UI at all?** If the goal is only fidelity, most of what you are
   buying is the toolbar, symbol search and saved layouts. If you disable all of it via
   `disabled_features`, you are paying the migration cost for a rendering engine that is *less*
   flexible than the one you have. Worth being honest about before phase 0.

## 17. Honest summary

- **Wins:** native gap handling, native between-plot fills, real execution shapes with tooltips,
  the full TradingView drawing toolbar and chart UI, ~1,800 lines of hand-rolled canvas deleted.
- **Losses:** gradient fills, free-form per-bar colours (palette quantization), Pine `table`
  (moves to DOM), pixel-exact control, and one npm dependency becomes a licensed vendored
  bundle you must keep updated by hand.
- **Cost:** ~1,200 new lines, six phases, all in `src/lib/tv/` and three hooks. Backend: zero.
- **Risk concentration:** the drawings path (phase 4) and the ten `redo` fixes in §7.5.
  Everything else is mechanical. Budget by the register, not by the line count: the plotting is
  a week, the ten re-solved canvas behaviours are the rest of it.
