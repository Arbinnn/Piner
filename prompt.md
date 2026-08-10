# Implement Pine Script Strategy Backtesting & Strategy Tester UI

## Project Context

I already have a working Pine Script indicator system.

The existing application uses:

* React
* TypeScript
* Vite
* Lightweight Charts
* Piner (`https://github.com/heyphat/piner`)
* Historical OHLCV data
* Existing Pine Script → execution → output → Lightweight Charts pipeline
* Existing indicator plotting functionality

The indicator implementation is already working.

**Do NOT rewrite or break the existing indicator functionality.**

The goal of this task is to add **Pine Script strategy support and a complete strategy backtesting interface** using Piner.

The user should be able to:

1. Write/paste Pine Script strategy code.
2. Execute the strategy against historical OHLCV data.
3. Detect `strategy.entry()`, `strategy.exit()`, `strategy.close()`, etc.
4. Generate trades and positions.
5. Plot entries/exits on the candlestick chart.
6. Plot strategy-related data.
7. Calculate complete backtest statistics.
8. Display a polished Strategy Tester dashboard.
9. Switch between chart and strategy results without losing the existing indicator functionality.

---

# 1. Core Architecture

Extend the existing architecture instead of creating a parallel system.

Current conceptual flow:

```text
Pine Script
    ↓
Piner
    ↓
Indicator Output
    ↓
Lightweight Charts
```

Add:

```text
Pine Script Strategy
        ↓
      Piner
        ↓
Strategy Runtime
        ↓
Orders / Trades / Positions
        ↓
Backtest Engine
        ↓
Performance Metrics
        ↓
Strategy Tester UI
        ↓
Lightweight Charts
```

The strategy engine should consume the same OHLCV dataset currently used by the indicator engine.

For example:

```text
data/
    ADBL.csv
```

Do not hardcode ADBL-specific logic.

The strategy system should work with any supported OHLCV dataset.

---

# 2. Strategy Detection

Determine whether the submitted Pine Script is an indicator or strategy.

A strategy will generally contain:

```pine
strategy(...)
```

while an indicator contains:

```pine
indicator(...)
```

Implement robust detection.

For example:

```ts
type PineScriptType = "indicator" | "strategy" | "unknown";
```

Create something equivalent to:

```ts
detectPineScriptType(source: string): PineScriptType
```

Do not rely only on a naive string search if Piner exposes a better AST/runtime mechanism.

The UI should automatically switch into Strategy Tester mode when a strategy is detected.

---

# 3. Strategy Execution

Use Piner as the Pine Script execution engine.

Do NOT manually translate Pine Script strategy code into JavaScript if Piner already provides the required execution functionality.

The strategy should be executed sequentially over historical candles.

Conceptually:

```ts
const result = await executeStrategy({
    source,
    bars,
    inputs,
});
```

The implementation should return structured strategy results.

Create clear TypeScript interfaces.

Example:

```ts
interface StrategyExecutionResult {
    equityCurve: EquityPoint[];
    trades: Trade[];
    orders: StrategyOrder[];
    positions: PositionSnapshot[];
    metrics: StrategyMetrics;
    plots: StrategyPlot[];
    signals: StrategySignal[];
}
```

Adapt these interfaces to the actual Piner API rather than blindly copying this example.

---

# 4. Strategy Orders

Support the strategy order concepts exposed by Piner.

At minimum, handle:

```pine
strategy.entry()
strategy.order()
strategy.exit()
strategy.close()
strategy.close_all()
```

Also account for:

```pine
strategy.cancel()
strategy.cancel_all()
```

if supported by Piner.

Create an internal normalized order representation.

Example:

```ts
interface StrategyOrder {
    id: string;
    type: "entry" | "exit" | "order" | "close";
    direction: "long" | "short";
    quantity: number;
    requestedPrice?: number;
    executedPrice?: number;
    timestamp: number;
    barIndex: number;
    status: "filled" | "cancelled" | "rejected";
    commission?: number;
    slippage?: number;
}
```

Use the actual supported semantics from Piner.

Do not invent unsupported Pine behavior.

---

# 5. Position Tracking

Maintain the complete position state throughout the backtest.

Track:

```ts
interface PositionSnapshot {
    timestamp: number;
    barIndex: number;
    size: number;
    direction: "long" | "short" | "flat";
    averageEntryPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    realizedPnL: number;
}
```

Support:

* Long positions
* Short positions
* Flat state
* Position increases
* Position reductions
* Position reversals
* Multiple entries/pyramiding when supported
* Partial exits when supported

Do not assume every strategy is long-only.

---

# 6. Trade Generation

Convert completed entry/exit sequences into normalized trades.

Example:

```ts
interface Trade {
    id: string;

    entryTime: number;
    exitTime?: number;

    entryBarIndex: number;
    exitBarIndex?: number;

    direction: "long" | "short";

    entryPrice: number;
    exitPrice?: number;

    quantity: number;

    grossPnL: number;
    commission: number;
    slippage: number;
    netPnL: number;

    returnPercent: number;

    durationMs?: number;

    entryOrderId?: string;
    exitOrderId?: string;
}
```

Closed trades must be distinguishable from open trades.

---

# 7. Backtest Configuration

Create a Strategy Tester configuration panel.

The user should be able to configure:

### Initial Capital

Example:

```text
Initial Capital
$100,000
```

### Position Size

Support whatever Piner supports, including:

* Fixed quantity
* Percentage of equity
* Cash value

### Commission

Allow:

```text
Commission type:
- Percentage
- Per order
- Per contract/share
```

### Slippage

Allow configurable slippage.

Example:

```text
Slippage: 1 tick
```

### Pyramiding

Allow the user to configure pyramiding if supported.

### Date Range

Allow:

```text
Entire dataset
Custom range
```

with:

```text
From
To
```

The configuration should be passed into the strategy execution layer.

---

# 8. OHLCV Data Adapter

Reuse the existing OHLCV data adapter.

Normalize data into:

```ts
interface OHLCVBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
```

Do not create a second CSV parser if the existing project already has one.

The strategy engine should receive normalized bars.

---

# 9. Strategy Plots

A strategy can contain plots just like an indicator.

For example:

```pine
plot(ta.sma(close, 20))
plot(ta.sma(close, 50))
```

These should continue to be rendered using the existing indicator plotting infrastructure wherever possible.

The strategy layer should therefore return:

```ts
interface StrategyPlot {
    id: string;
    title: string;
    values: {
        time: number;
        value: number | null;
    }[];
    style?: PlotStyle;
}
```

Reuse existing plotting code.

Do not duplicate the entire indicator plotting system.

---

# 10. Buy/Sell Markers on Chart

This is one of the most important features.

Every executed strategy entry/exit should be visible directly on the candlestick chart.

Example:

```text
                SELL
                 ↓
        ┌───────────────┐
        │      candle   │
        └───────────────┘

        ┌───────────────┐
        │      candle   │
        └───────────────┘
                 ↑
                BUY
```

Use Lightweight Charts markers.

For long entry:

```text
BUY
```

For short entry:

```text
SELL SHORT
```

For long exit:

```text
EXIT LONG
```

For short exit:

```text
EXIT SHORT
```

Markers should contain:

* Timestamp
* Price
* Order ID
* Quantity
* P&L when available

Hovering/clicking a trade marker should show a small tooltip/popover.

Example:

```text
Trade #17

Long
Entry: 412.50
Exit: 428.20
Qty: 100
P&L: +1,570
Return: +3.81%
Duration: 2d 4h
```

---

# 11. Entry/Exit Visualization

Use visually distinct markers for:

### Long Entry

Up marker below candle.

### Short Entry

Down marker above candle.

### Long Exit

Exit marker near candle.

### Short Exit

Exit marker near candle.

Do not allow strategy markers to completely obscure candle information.

Allow users to toggle:

```text
☑ Entries
☑ Exits
☑ Open Positions
☑ Strategy Plots
```

---

# 12. Equity Curve

Create an equity curve based on the actual strategy execution.

Example:

```ts
interface EquityPoint {
    time: number;
    equity: number;
    cash: number;
    unrealizedPnL: number;
    realizedPnL: number;
}
```

Display the equity curve in the Strategy Tester.

Prefer a Lightweight Charts line series if that fits the existing architecture.

The curve should update whenever the strategy is re-run.

---

# 13. Strategy Tester Dashboard

Create a polished dashboard similar in concept to TradingView's Strategy Tester.

Do not copy TradingView's UI pixel-for-pixel.

Build a modern application-native UI.

Suggested structure:

```text
┌──────────────────────────────────────────────────────────────┐
│ Strategy Tester                                              │
│ SMA Crossover Strategy                       ● Backtest Ready │
├──────────────────────────────────────────────────────────────┤
│ Overview | Performance | Trades | Risk | Settings            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Net Profit       Return       Win Rate       Max Drawdown     │
│ +$12,450        +12.45%        58.2%          -6.81%          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    Equity Curve                              │
│                                                              │
│              ╱╲       ╱╲                                    │
│       ╱─────╱  ╲─────╱  ╲────────                            │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Performance Metrics                                          │
│                                                              │
│ Total Trades      Winning Trades       Losing Trades         │
│ Profit Factor     Avg Trade            Avg Winning Trade     │
│ Avg Losing Trade  Sharpe Ratio         Sortino Ratio         │
│ Max Drawdown      Recovery Factor     Expectancy            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

# 14. Overview Tab

The Overview tab should show the most important statistics.

Cards:

### Net Profit

```text
+$12,450
+12.45%
```

### Total Return

```text
+12.45%
```

### Total Trades

```text
143
```

### Win Rate

```text
58.04%
```

### Profit Factor

```text
1.82
```

### Max Drawdown

```text
-6.81%
```

### Sharpe Ratio

```text
1.47
```

### Sortino Ratio

```text
2.08
```

Use appropriate positive/negative styling.

Do not hardcode colors throughout the application.

Use the existing theme/token system if one exists.

---

# 15. Performance Metrics

Implement a proper metrics engine.

At minimum calculate:

## Returns

* Initial capital
* Final equity
* Net profit
* Gross profit
* Gross loss
* Total return
* Annualized return if enough time data exists

## Trades

* Total trades
* Winning trades
* Losing trades
* Win rate
* Average trade
* Average winning trade
* Average losing trade
* Largest winning trade
* Largest losing trade

## Risk

* Maximum drawdown
* Maximum drawdown percentage
* Drawdown duration
* Sharpe ratio
* Sortino ratio
* Recovery factor
* Profit factor
* Expectancy

## Position statistics

* Average holding time
* Long trades
* Short trades
* Long win rate
* Short win rate

Do not silently return fake values.

If a metric cannot be meaningfully calculated because there is insufficient data, return `null` and display:

```text
N/A
```

---

# 16. Correct Metric Formulas

Use standard formulas.

### Net Profit

```text
Final Equity - Initial Capital
```

### Gross Profit

Sum all positive net trade P&L.

### Gross Loss

Absolute sum of all negative net trade P&L.

### Profit Factor

```text
Gross Profit / Gross Loss
```

Handle zero-loss cases correctly.

### Win Rate

```text
Winning Trades / Closed Trades × 100
```

### Average Trade

```text
Net Profit / Closed Trades
```

### Expectancy

Use:

```text
(Win Rate × Average Win)
-
(Loss Rate × Average Loss)
```

with consistent units.

### Maximum Drawdown

Calculate the largest peak-to-trough decline in the equity curve.

Provide both:

```text
Absolute Drawdown
Percentage Drawdown
```

### Sharpe Ratio

Calculate from periodic strategy returns.

Do not calculate Sharpe from individual trade P&L unless that is explicitly the selected methodology.

Document the methodology in code.

---

# 17. Drawdown Chart

Add a Drawdown visualization.

Example:

```text
Equity
  │       ╱──────╲
  │──────╯        ╲──────╮
  │                      ╲
  │                       ╲
  └──────────────────────────── Time

Drawdown
  │
0%├────────────────────────
  │       ╲
-5%│        ╲─────╮
  │              ╲
-10%│             ╲────
  └──────────────────────── Time
```

This should help users understand periods of poor performance.

---

# 18. Trades Tab

Create a detailed trade table.

Columns:

```text
#
Direction
Entry Time
Entry Price
Exit Time
Exit Price
Quantity
P&L
Return %
Duration
```

Example:

```text
#17
LONG
2026-04-12 10:15
412.50
2026-04-14 13:30
428.20
100
+$1,570
+3.81%
2d 3h 15m
```

Features:

* Sorting
* Filtering
* Search
* Pagination or virtualization for large datasets
* Click trade → focus chart on that trade
* Positive/negative P&L formatting

For thousands of trades, use virtualization rather than rendering every row at once.

---

# 19. Trade Details

When the user clicks a trade:

1. Highlight the trade in the table.
2. Move/focus the chart to the trade's time range.
3. Highlight the entry marker.
4. Highlight the exit marker.
5. Display trade details.

Example:

```text
Trade #24

Direction       LONG
Entry           2026-05-12 11:00
Entry Price     428.40
Exit            2026-05-15 14:00
Exit Price      447.20

Quantity        100

Gross P&L       +1,880
Commission      -20
Slippage        -5
Net P&L         +1,855

Return          +4.33%
Duration        3d 3h
```

---

# 20. Long vs Short Analysis

Provide a breakdown:

```text
             Long        Short
Trades        72          51
Win Rate      61.1%       54.9%
Net P&L      +$8,420     +$4,030
Avg Trade     +$117        +$79
```

This is useful for determining whether a strategy is dependent on one market direction.

---

# 21. Monthly / Periodic Performance

Create a performance breakdown.

Allow:

```text
Daily
Weekly
Monthly
Yearly
```

For monthly:

```text
2026 Jan    +2.4%
2026 Feb    -1.2%
2026 Mar    +4.1%
2026 Apr    +0.8%
...
```

Prefer a heatmap-style UI if the existing component system supports it.

Otherwise use a clean table.

---

# 22. Backtest Settings UI

Create a settings panel for:

```text
Initial Capital
Commission
Slippage
Position Size
Pyramiding
Date Range
```

Also expose Pine strategy inputs.

For example:

```pine
length = input.int(20, "Length")
risk = input.float(2.0, "Risk")
```

The UI should detect supported Pine inputs and expose them as editable controls.

Example:

```text
Strategy Inputs

Length
[ 20 ]

Risk %
[ 2.0 ]

Fast MA
[ 10 ]

Slow MA
[ 30 ]

            [Run Backtest]
```

Changing an input should rerun the strategy.

Do not require users to manually edit the Pine code for supported input types.

---

# 23. Input Controls

Support, where Piner exposes them:

```text
input.int()
input.float()
input.bool()
input.string()
input.source()
input.timeframe()
input.color()
```

Map them to appropriate React controls.

Examples:

```text
int       → number input / slider
float     → number input
bool      → switch
string    → text/select
color     → color picker
timeframe → select
```

Keep the implementation extensible.

---

# 24. Run Button and Execution State

Create a prominent:

```text
▶ Run Backtest
```

button.

States:

```text
Idle
Running
Completed
Error
```

During execution:

```text
Running strategy...
Processing 42,813 candles
██████████████████░░░░ 78%
```

If Piner supports progress callbacks, use them.

If it does not, do not fake a precise progress percentage.

Use:

```text
Running backtest...
```

instead.

---

# 25. Error Handling

Pine compilation/runtime errors should be displayed in a developer-friendly way.

Example:

```text
Strategy Error

Line 24
strategy.entry() requires ...

[Jump to line]
```

Do not crash the React application.

Catch:

* Pine compilation errors
* Runtime errors
* Invalid strategy configuration
* Invalid historical data
* Unsupported Piner features
* Empty datasets
* Invalid inputs

Use the existing editor error system if one already exists.

---

# 26. Unsupported Pine Features

Do not pretend unsupported Pine features work.

If Piner does not support a specific strategy feature:

```text
Unsupported strategy feature

This strategy uses:
strategy.someFeature()

This feature is not currently supported by the execution engine.
```

Keep the system extensible so additional Piner support can be added later.

---

# 27. Strategy Result State Management

Keep strategy state separate from indicator state.

Suggested:

```ts
interface StrategyState {
    source: string;

    status:
        | "idle"
        | "running"
        | "success"
        | "error";

    config: StrategyConfig;

    result?: StrategyExecutionResult;

    error?: StrategyError;
}
```

Do not mix strategy metrics into the existing indicator result objects.

---

# 28. Caching

Avoid unnecessary backtest executions.

Generate a cache key from:

```text
Pine source
Dataset
Timeframe
Date range
Strategy settings
Input values
Commission
Slippage
Initial capital
```

If nothing changed, reuse the previous result.

Example:

```ts
strategyCache.get(cacheKey)
```

Do not cache stale results after any relevant configuration change.

---

# 29. Performance

The strategy system must be able to process large historical datasets.

Avoid:

```ts
setState(...)
```

inside every candle iteration.

Do not cause React re-renders for every bar.

Instead:

```text
Piner
  ↓
Execution
  ↓
Raw result
  ↓
One state update
  ↓
UI render
```

Use Web Workers if strategy execution blocks the browser UI.

Preferred architecture:

```text
React Main Thread
        │
        │
        ▼
Web Worker
        │
        ▼
Piner Strategy Execution
        │
        ▼
Strategy Result
        │
        ▼
React
```

If Piner cannot run inside a Worker due to its dependencies, keep the execution layer abstract so a Worker can be introduced later.

---

# 30. Large Trade Tables

If a strategy generates thousands or hundreds of thousands of trades:

* Do not render every row directly.
* Use virtualized rendering.
* Keep sorting/filtering efficient.
* Avoid copying the entire trade array repeatedly.

---

# 31. Chart Integration

Do not create a second chart.

Use the existing Lightweight Charts instance.

Strategy mode should add:

```text
Candlestick series
+
Strategy plots
+
Entry markers
+
Exit markers
+
Optional position visualization
```

The chart should remain fully interactive:

* Zoom
* Pan
* Crosshair
* Time scale
* Existing drawing tools
* Existing indicators

Do not break existing chart functionality.

---

# 32. Strategy Position Visualization

Add an optional setting:

```text
Show position background
```

When enabled:

```text
Long position  → subtle chart background region
Short position → subtle chart background region
Flat           → normal
```

Do not use excessive opacity or obscure candles.

If this is difficult with Lightweight Charts, implement it as an optional secondary series/primitive only if the existing chart architecture supports it cleanly.

---

# 33. Strategy Summary Header

At the top of the Strategy Tester:

```text
SMA Crossover Strategy

ADBL · 1D

$100,000 → $112,450

+12.45%
143 Trades
58.04% Win Rate
6.81% Max DD
```

Also show:

```text
Backtest period:
Jan 1, 2024 → Aug 10, 2026
```

---

# 34. Responsive UI

The Strategy Tester should work on:

* Desktop
* Laptop
* Smaller screens

Desktop:

```text
┌───────────────────────────────────────┐
│ Chart                                 │
├───────────────────────────────────────┤
│ Strategy Tester                       │
│ Metrics                               │
│ Equity Curve                          │
│ Tables                                │
└───────────────────────────────────────┘
```

On smaller screens:

```text
Chart
↓
Metrics
↓
Equity
↓
Trades
```

Use responsive CSS/grid/flexbox.

Do not introduce a heavy UI library if the project already has an established design system.

---

# 35. Dark Theme

The UI should work naturally with the application's existing theme.

Use existing CSS variables/design tokens.

Avoid hardcoded colors such as:

```css
background: #121212;
color: #ffffff;
```

if the application already has theme variables.

Use semantic tokens:

```css
--background
--foreground
--card
--border
--muted
--positive
--negative
```

or whatever the project already uses.

---

# 36. Component Structure

Organize the implementation into reusable components.

Suggested structure:

```text
src/
├── strategy/
│   ├── types.ts
│   ├── strategyDetector.ts
│   ├── strategyExecutor.ts
│   ├── strategyAdapter.ts
│   ├── backtestEngine.ts
│   ├── metrics.ts
│   ├── tradeBuilder.ts
│   ├── equityCurve.ts
│   ├── drawdown.ts
│   ├── strategyCache.ts
│   └── index.ts
│
├── components/
│   └── strategy/
│       ├── StrategyTester.tsx
│       ├── StrategyHeader.tsx
│       ├── StrategyMetrics.tsx
│       ├── StrategyOverview.tsx
│       ├── StrategyEquityCurve.tsx
│       ├── StrategyDrawdown.tsx
│       ├── StrategyTrades.tsx
│       ├── StrategyTradeDetails.tsx
│       ├── StrategySettings.tsx
│       ├── StrategyInputs.tsx
│       ├── StrategyPerformance.tsx
│       └── StrategyError.tsx
```

Adapt this to the existing project structure.

Do not blindly create duplicate utilities.

---

# 37. Data Flow

The intended flow should be:

```text
User enters Pine Script
        ↓
Detect indicator vs strategy
        ↓
strategy(...)
        ↓
Parse/compile with Piner
        ↓
Extract Pine inputs
        ↓
User configures inputs
        ↓
Run strategy
        ↓
Piner executes over OHLCV
        ↓
Normalize strategy orders
        ↓
Build trades
        ↓
Build positions
        ↓
Build equity curve
        ↓
Calculate metrics
        ↓
Return StrategyExecutionResult
        ↓
Update chart
        ↓
Update Strategy Tester
```

---

# 38. Important: Do Not Build a Fake Backtester

The system must not simply detect:

```pine
strategy.entry()
```

and place a visual BUY marker.

It must actually maintain:

```text
Orders
Positions
Cash
Equity
Realized P&L
Unrealized P&L
Commissions
Slippage
Trades
```

and derive the dashboard metrics from the actual execution result.

---

# 39. Avoid Lookahead Bias

Historical execution must respect chronological order.

Never allow future candle information to influence previous trades.

Process:

```text
Bar 0
Bar 1
Bar 2
Bar 3
...
```

sequentially.

Respect Piner's execution semantics for:

* `open`
* `high`
* `low`
* `close`
* order execution timing
* next-bar execution
* intrabar execution

Do not create custom behavior that contradicts Piner.

---

# 40. Commission and Slippage

Ensure commission and slippage affect:

```text
Trade P&L
Equity
Net Profit
Profit Factor
Drawdown
Sharpe
Sortino
Expectancy
```

Do not only display them as cosmetic values.

---

# 41. Open Trades

At the end of the backtest, an open position should remain identifiable.

Dashboard should distinguish:

```text
Closed Trades: 143
Open Position: LONG
```

Do not incorrectly count an open trade as a completed winning/losing trade.

Equity should include unrealized P&L when appropriate.

---

# 42. Export

Add optional export functionality.

Allow users to export:

### Trades CSV

```text
Trade ID
Direction
Entry
Exit
Quantity
Gross P&L
Commission
Slippage
Net P&L
Return
Duration
```

### Backtest Summary JSON

Include:

```text
strategy
dataset
settings
metrics
trades
equity curve
```

Use browser-side generation if possible.

---

# 43. Testing

Create tests for the strategy engine.

At minimum test:

### Long strategy

```pine
strategy("Long Test")

if condition
    strategy.entry("Long", strategy.long)
```

Verify:

* Entry created
* Position becomes long
* Equity changes correctly

### Exit strategy

Verify:

* Entry
* Exit
* Trade generation
* P&L

### Short strategy

Verify:

* Short entry
* Short exit
* Correct P&L

### Losing trade

Verify negative P&L.

### Commission

Verify commission reduces net P&L.

### Slippage

Verify slippage affects execution/P&L according to configured semantics.

### Multiple trades

Verify trade count and statistics.

### Open position

Verify open positions aren't counted as closed trades.

### No trades

Verify dashboard handles:

```text
0 trades
```

without NaN/Infinity.

---

# 44. Edge Cases

Handle:

```text
No trades
One trade
All winning trades
All losing trades
Only long trades
Only short trades
Open position at end
Zero commission
Zero slippage
Large commission
Very small capital
Large quantities
Missing OHLCV values
Duplicate timestamps
Empty dataset
Invalid timeframe
Invalid Pine script
Piner runtime error
Unsupported strategy function
```

Never allow:

```text
NaN
Infinity
undefined
```

to leak into the UI.

Display:

```text
N/A
```

where appropriate.

---

# 45. UI Interaction

The user experience should be:

```text
1. User opens Pine editor.

2. User enters:

strategy("EMA Strategy")

3. Application detects strategy.

4. Strategy Tester panel becomes available.

5. User clicks Run Backtest.

6. Strategy executes.

7. Chart displays:
   - Entries
   - Exits
   - Strategy plots

8. Strategy Tester displays:
   - Net profit
   - Return
   - Win rate
   - Profit factor
   - Drawdown
   - Sharpe
   - Trades

9. User clicks a trade.

10. Chart focuses on that trade.

11. User changes an input.

12. User clicks Run Backtest.

13. Results update.
```

---

# 46. Preserve Existing Indicator Mode

This is critical.

Existing behavior:

```text
indicator(...)
```

must remain unchanged.

New behavior:

```text
strategy(...)
```

activates Strategy Tester.

Conceptually:

```ts
if (scriptType === "indicator") {
    runIndicator();
}

if (scriptType === "strategy") {
    runStrategy();
}
```

Share:

* OHLCV parser
* Piner initialization
* chart instance
* Pine inputs
* plot renderer
* theme
* editor
* error handling

where appropriate.

---

# 47. Do Not Over-Engineer

Before adding new infrastructure, inspect the existing project.

Reuse:

* Existing Pine execution wrapper
* Existing chart manager
* Existing indicator output types
* Existing CSV loader
* Existing state management
* Existing UI components
* Existing styling system

Only create new abstractions where they solve an actual strategy-specific problem.

---

# 48. Implementation Process

Before writing code:

### Step 1

Inspect the entire existing project structure.

Identify:

```text
Pine execution code
Chart rendering
OHLCV data loading
Indicator output handling
Editor
Input handling
State management
UI components
```

### Step 2

Identify exactly how Piner is currently initialized and executed.

Do not create another Piner instance unless required.

### Step 3

Determine the actual Piner API available in the installed version.

Inspect its TypeScript definitions/source/package.

Especially inspect:

```text
strategy
strategy.entry
strategy.exit
strategy.close
strategy.order
strategy.position
strategy.equity
strategy.opentrades
strategy.closedtrades
```

and related APIs.

### Step 4

Build a minimal strategy execution proof of concept.

Use:

```pine
//@version=6
strategy("Test Strategy")

fast = ta.sma(close, 10)
slow = ta.sma(close, 30)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)

if ta.crossunder(fast, slow)
    strategy.close("Long")

plot(fast)
plot(slow)
```

Execute it against the existing ADBL dataset.

### Step 5

Verify actual trades are returned.

### Step 6

Normalize the results.

### Step 7

Build the metrics engine.

### Step 8

Integrate chart markers.

### Step 9

Build Strategy Tester UI.

### Step 10

Add settings and Pine input controls.

### Step 11

Add trade table and interaction.

### Step 12

Add performance/drawdown views.

### Step 13

Add caching/performance optimizations.

### Step 14

Run tests.

### Step 15

Verify existing indicators still work.

---

# 49. Acceptance Criteria

The implementation is complete only when all of the following work:

## Pine Strategy

A user can paste:

```pine
//@version=6
strategy("EMA Cross", overlay=true)

fast = ta.ema(close, 10)
slow = ta.ema(close, 30)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)

if ta.crossunder(fast, slow)
    strategy.close("Long")

plot(fast)
plot(slow)
```

and click:

```text
Run Backtest
```

## Chart

The chart displays:

```text
Candles
EMA 10
EMA 30
Long entries
Long exits
```

## Dashboard

The dashboard displays:

```text
Net Profit
Total Return
Total Trades
Win Rate
Profit Factor
Max Drawdown
Sharpe Ratio
Sortino Ratio
```

## Equity

An equity curve is displayed.

## Trades

A trade table is displayed.

## Interaction

Clicking a trade focuses the chart on that trade.

## Inputs

Changing Pine inputs changes the backtest.

## Settings

Changing commission/slippage/initial capital changes results.

## Indicators

Existing indicator functionality remains fully operational.

## Errors

Invalid strategies produce useful errors without crashing the application.

---

# 50. Final Code Quality Requirements

Use strict TypeScript.

Avoid:

```ts
any
```

unless absolutely unavoidable around the external Piner API.

Use explicit interfaces.

Separate:

```text
Piner integration
Strategy normalization
Trade generation
Metrics
UI
```

Do not put all strategy logic inside one React component.

Do not duplicate existing indicator logic.

Do not hardcode dataset-specific behavior.

Do not hardcode strategy results.

Do not fake metrics.

Do not fake execution progress.

Do not introduce unnecessary dependencies.

After implementation, provide a concise summary containing:

1. Files created
2. Files modified
3. Piner APIs used
4. Strategy features supported
5. Metrics implemented
6. Any Piner limitations discovered
7. Tests performed
8. Any remaining limitations

Most importantly: **implement the feature in the existing project rather than only describing how it could be implemented.**
