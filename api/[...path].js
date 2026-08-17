// server/candles.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
var DATA_DIR = path.join(process.cwd(), "server", "data");
var SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
var REQUIRED_COLUMNS = ["date", "open", "high", "low", "close", "volume"];
var DatasetError = class extends Error {
  status;
  constructor(message, status = 404) {
    super(message);
    this.name = "DatasetError";
    this.status = status;
  }
};
var datasets = /* @__PURE__ */ new Map();
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let columnOrder = REQUIRED_COLUMNS;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const cells = line.split(",").map((cell) => cell.trim());
    const first = cells[0]?.toLowerCase();
    if (first === "date" || first === "time") {
      columnOrder = cells.map((c) => c.toLowerCase());
      continue;
    }
    const candle = rowToCandle(cells, columnOrder);
    if (candle) rows.push(candle);
  }
  rows.sort((a, b) => a.time - b.time);
  return dedupeByTime(rows);
}
function rowToCandle(cells, columns) {
  const get = (name) => {
    const idx = columns.indexOf(name);
    return idx === -1 ? void 0 : cells[idx];
  };
  const dateStr = get("date");
  const open = Number(get("open"));
  const high = Number(get("high"));
  const low = Number(get("low"));
  const close = Number(get("close"));
  const volume = Number(get("volume") ?? "0");
  if (!dateStr) return null;
  const time = toUnixSeconds(dateStr);
  if (time === null) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0
  };
}
function toUnixSeconds(dateStr) {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr);
  return Number.isFinite(ms) ? Math.floor(ms / 1e3) : null;
}
function dedupeByTime(candles) {
  const out = [];
  for (const c of candles) {
    if (out.length > 0 && out[out.length - 1].time === c.time) {
      out[out.length - 1] = c;
    } else {
      out.push(c);
    }
  }
  return out;
}
function loadSymbol(symbol) {
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new DatasetError(`Invalid symbol '${symbol}'.`, 400);
  }
  const key = symbol.toUpperCase();
  const hit = datasets.get(key);
  if (hit) return hit;
  const pending = readFile(path.join(DATA_DIR, `${key}.csv`), "utf8").catch(() => {
    throw new DatasetError(`No data for symbol '${key}'.`);
  }).then((text) => {
    const candles = parseCsv(text);
    if (candles.length === 0) throw new DatasetError(`Dataset for '${key}' contains no usable rows.`, 422);
    return candles;
  });
  pending.catch(() => datasets.delete(key));
  datasets.set(key, pending);
  return pending;
}
function recentBars(candles, bars) {
  if (bars === void 0 || bars >= candles.length) return candles;
  return candles.slice(candles.length - bars);
}
function toPinerBars(candles) {
  return candles.map((c) => ({
    time: c.time * 1e3,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
}
function fingerprint(candles) {
  if (candles.length === 0) return "empty";
  const last = candles[candles.length - 1];
  return `${candles.length}:${candles[0].time}:${last.time}:${last.close}`;
}

// server/pine/runtime.ts
import { ArrayFeed, Engine } from "@heyphat/piner";

// server/pine/htfTime.ts
var DAY_MS = 864e5;
var WEEK_EPOCH_OFFSET_DAYS = 3;
function parseTf(tf) {
  const m = /^(\d*)([a-zA-Z]?)$/.exec(tf);
  if (!m) return { mult: 1, unit: "" };
  return { mult: m[1] ? Number(m[1]) : 1, unit: (m[2] || "").toUpperCase() };
}
function bucketStart(timeMs, tf) {
  if (!Number.isFinite(timeMs)) return NaN;
  const { mult, unit } = parseTf(tf);
  if (!(mult > 0)) return timeMs;
  switch (unit) {
    case "S":
      return Math.floor(timeMs / (mult * 1e3)) * mult * 1e3;
    case "D":
      return Math.floor(timeMs / (mult * DAY_MS)) * mult * DAY_MS;
    case "W": {
      const days = Math.floor(timeMs / DAY_MS) + WEEK_EPOCH_OFFSET_DAYS;
      return (Math.floor(days / (7 * mult)) * 7 * mult - WEEK_EPOCH_OFFSET_DAYS) * DAY_MS;
    }
    case "M": {
      const d = new Date(timeMs);
      return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / mult) * mult, 1);
    }
    default:
      return Math.floor(timeMs / (mult * 6e4)) * mult * 6e4;
  }
}
function patchHtfTime(ctx) {
  const original = ctx.timeFn.bind(ctx);
  ctx.timeFn = function patched(tf, session, tz) {
    if (typeof session === "string" && session !== "") return original(tf, session, tz);
    if (typeof tf !== "string" || tf === "") return original(tf, session, tz);
    return bucketStart(ctx.time, tf);
  };
}

// server/pine/runtime.ts
async function runScript(compiled2, bars, inputs, opts) {
  try {
    const engine = new Engine(compiled2, new ArrayFeed(bars), {
      historySlotCount: compiled2.metadata.historySlotCount,
      inputs,
      ...opts.strategy ? { strategy: opts.strategy } : {}
    });
    patchHtfTime(engine.ctx);
    await engine.run({ symbol: opts.symbol, timeframe: opts.timeframe, mintick: opts.mintick });
    return {
      outputs: engine.outputs,
      drawings: engine.drawings,
      strategy: compiled2.metadata.isStrategy ? { report: engine.strategy, metrics: engine.strategyMetrics(), openLots: readOpenLots(engine) } : null,
      error: null
    };
  } catch (err) {
    return {
      outputs: null,
      drawings: [],
      strategy: null,
      error: {
        heading: "Runtime Error",
        message: err instanceof Error ? err.message : String(err)
      }
    };
  }
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function readOpenLots(engine) {
  const broker = engine.ctx.strategyBroker;
  const count = Math.max(0, Math.trunc(engine.ctx.strategy.opentrades));
  const lots = [];
  for (let i = 0; i < count; i += 1) {
    const size = num(broker.tradeField("opentrades", "size", i));
    if (size === 0) continue;
    lots.push({
      entryId: String(broker.tradeField("opentrades", "entry_id", i)),
      size,
      entryPrice: num(broker.tradeField("opentrades", "entry_price", i)),
      entryBarIndex: num(broker.tradeField("opentrades", "entry_bar_index", i)),
      entryTime: num(broker.tradeField("opentrades", "entry_time", i))
    });
  }
  return lots;
}

// src/strategy/metrics.ts
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function ratio(numerator, denominator) {
  return denominator === 0 ? null : finite(numerator / denominator);
}
function mean(values) {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}
function directionStats(trades, direction) {
  const subset = trades.filter((t) => t.direction === direction);
  const wins = subset.filter((t) => t.netPnL > 0).length;
  const netPnL = subset.reduce((sum, t) => sum + t.netPnL, 0);
  return {
    trades: subset.length,
    winRate: subset.length === 0 ? null : wins / subset.length * 100,
    netPnL,
    avgTrade: ratio(netPnL, subset.length)
  };
}
function maxDrawdownDuration(curve) {
  if (curve.length === 0) return { bars: null, ms: null };
  let peakEquity = curve[0].equity;
  let peakIndex = 0;
  let bars = 0;
  let ms = 0;
  for (let i = 1; i < curve.length; i += 1) {
    const point = curve[i];
    if (point.equity >= peakEquity) {
      peakEquity = point.equity;
      peakIndex = i;
      continue;
    }
    const spanBars = i - peakIndex;
    if (spanBars > bars) {
      bars = spanBars;
      ms = (point.time - curve[peakIndex].time) * 1e3;
    }
  }
  return bars === 0 ? { bars: 0, ms: 0 } : { bars, ms };
}
function capitalRequirements(positions, equityCurve, initialCapital, marginFraction) {
  let required = 0;
  let usage = null;
  for (let i = 0; i < positions.length && i < equityCurve.length; i += 1) {
    const position = positions[i];
    if (position.size === 0) continue;
    const committed = Math.abs(position.size) * position.currentPrice * marginFraction;
    const shortfall = Math.max(0, initialCapital - equityCurve[i].equity);
    required = Math.max(required, committed + shortfall);
    const equity = equityCurve[i].equity;
    if (equity > 0) usage = Math.max(usage ?? 0, committed / equity * 100);
  }
  return { accountSizeRequired: required, peakMarginUsagePercent: usage };
}
var MS_PER_DAY = 864e5;
function equityPhases(curve) {
  if (curve.length < 2) return [];
  const phases = [];
  const push = (kind, from, extreme, to, open) => {
    if (extreme <= from) return;
    const start = curve[from];
    const magnitude = Math.abs(curve[extreme].equity - start.equity);
    if (magnitude === 0) return;
    const end = curve[to];
    phases.push({
      kind,
      startTime: start.time,
      endTime: end.time,
      startBarIndex: from,
      endBarIndex: to,
      magnitude,
      percent: start.equity !== 0 ? magnitude / Math.abs(start.equity) * 100 : 0,
      durationDays: (end.time - start.time) * 1e3 / MS_PER_DAY,
      open
    });
  };
  let peakIndex = 0;
  let troughIndex = 0;
  let inDrawdown = false;
  for (let i = 1; i < curve.length; i += 1) {
    const equity = curve[i].equity;
    if (!inDrawdown) {
      if (equity >= curve[peakIndex].equity) {
        peakIndex = i;
      } else {
        push("runup", troughIndex, peakIndex, peakIndex, false);
        inDrawdown = true;
        troughIndex = i;
      }
      continue;
    }
    if (equity < curve[troughIndex].equity) troughIndex = i;
    if (equity >= curve[peakIndex].equity) {
      push("drawdown", peakIndex, troughIndex, i, false);
      inDrawdown = false;
      peakIndex = i;
    }
  }
  const last = curve.length - 1;
  if (inDrawdown) push("drawdown", peakIndex, troughIndex, last, true);
  else push("runup", troughIndex, last, last, true);
  return phases;
}
function phaseStats(phases, kind) {
  const all = phases.filter((p) => p.kind === kind);
  const closed = all.filter((p) => !p.open);
  const open = all.find((p) => p.open);
  return {
    max: all.length === 0 ? 0 : Math.max(...all.map((p) => p.magnitude)),
    average: mean(closed.map((p) => p.magnitude)),
    current: open?.magnitude ?? 0,
    maxPercent: all.length === 0 ? 0 : Math.max(...all.map((p) => p.percent)),
    averagePercent: mean(closed.map((p) => p.percent)),
    currentPercent: open?.percent ?? 0,
    averageDurationDays: mean(closed.map((p) => p.durationDays)),
    count: all.length
  };
}
function computeSummary(report, pinerMetrics, trades, equityCurve, positions, openPosition, config) {
  const initialCapital = report.initialCapital;
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const closed = trades.length;
  const winners = trades.filter((t) => t.netPnL > 0);
  const losers = trades.filter((t) => t.netPnL < 0);
  const avgWin = mean(winners.map((t) => t.netPnL));
  const avgLoss = mean(losers.map((t) => -t.netPnL));
  const winRate = closed === 0 ? null : report.wins / closed * 100;
  const expectancy = winRate === null || avgWin === null || avgLoss === null ? closed === 0 ? null : ratio(report.netProfit, closed) : winRate / 100 * avgWin - (1 - winRate / 100) * avgLoss;
  const profitFactor = report.grossLoss > 0 ? report.grossProfit / report.grossLoss : report.grossProfit > 0 ? Infinity : null;
  const duration = maxDrawdownDuration(equityCurve);
  const spanMs = equityCurve.length > 1 ? (equityCurve[equityCurve.length - 1].time - equityCurve[0].time) * 1e3 : 0;
  const DAY_MS2 = 864e5;
  const netProfitPercent = initialCapital > 0 ? report.netProfit / initialCapital * 100 : 0;
  const buyHold = finite(pinerMetrics.buyHoldReturnPercent);
  const marginFraction = Math.max(config.marginLong, config.marginShort) / 100;
  const capital = capitalRequirements(positions, equityCurve, initialCapital, marginFraction);
  const phases = equityPhases(equityCurve);
  const runups = phaseStats(phases, "runup");
  const drawdowns = phaseStats(phases, "drawdown");
  return {
    initialCapital,
    finalEquity,
    netProfit: report.netProfit,
    netProfitPercent,
    grossProfit: report.grossProfit,
    grossLoss: report.grossLoss,
    totalCommission: report.totalCommission,
    annualizedReturnPercent: spanMs >= DAY_MS2 ? finite(pinerMetrics.cagrPercent) : null,
    buyHoldReturnPercent: buyHold,
    buyHoldPnL: finite(pinerMetrics.buyHoldPnL),
    outperformancePercent: buyHold === null ? null : netProfitPercent - buyHold,
    openPnL: openPosition?.unrealizedPnL ?? 0,
    totalTrades: closed,
    openTrades: openPosition?.trades.length ?? 0,
    winningTrades: report.wins,
    losingTrades: report.losses,
    evenTrades: report.evens,
    winRate,
    avgTrade: ratio(report.netProfit, closed),
    avgTradePercent: mean(trades.map((t) => t.returnPercent)),
    avgWinningTrade: avgWin,
    avgLosingTrade: avgLoss === null ? null : -avgLoss,
    winLossRatio: avgWin === null || avgLoss === null || avgLoss === 0 ? null : avgWin / avgLoss,
    largestWinningTrade: winners.length === 0 ? null : Math.max(...winners.map((t) => t.netPnL)),
    largestLosingTrade: losers.length === 0 ? null : Math.min(...losers.map((t) => t.netPnL)),
    maxConsecutiveWins: closed === 0 ? null : pinerMetrics.maxConsecutiveWins,
    maxConsecutiveLosses: closed === 0 ? null : pinerMetrics.maxConsecutiveLosses,
    maxDrawdown: report.maxDrawdown,
    maxDrawdownPercent: report.maxDrawdownPercent,
    maxDrawdownDurationBars: duration.bars,
    maxDrawdownDurationMs: duration.ms,
    maxRunup: report.maxRunup,
    maxRunupPercent: report.maxRunupPercent,
    avgRunup: equityCurve.length < 2 ? null : finite(pinerMetrics.avgRunupCloseToClose),
    avgDrawdown: equityCurve.length < 2 ? null : finite(pinerMetrics.avgDrawdownCloseToClose),
    avgRunupDurationDays: equityCurve.length < 2 ? null : finite(pinerMetrics.avgRunupDurationDays),
    avgDrawdownDurationDays: equityCurve.length < 2 ? null : finite(pinerMetrics.avgDrawdownDurationDays),
    maxDrawdownPercentOfInitialCapital: finite(pinerMetrics.maxDrawdownPercentOfInitialCapital) ?? 0,
    maxRunupPercentOfInitialCapital: finite(pinerMetrics.maxRunupPercentOfInitialCapital) ?? 0,
    returnOnInitialCapitalPercent: finite(pinerMetrics.returnOnInitialCapitalPercent) ?? 0,
    returnOfMaxDrawdown: report.maxDrawdown > 0 ? report.netProfit / report.maxDrawdown : null,
    runupPhases: runups,
    drawdownPhases: drawdowns,
    // Sharpe/Sortino need at least a couple of equity observations to mean anything.
    sharpe: equityCurve.length < 2 || closed === 0 ? null : finite(pinerMetrics.sharpe),
    sortino: equityCurve.length < 2 || closed === 0 ? null : pinerMetrics.sortino,
    volatilityPercent: equityCurve.length < 2 ? null : finite(pinerMetrics.volatilityPercent),
    profitFactor,
    recoveryFactor: report.maxDrawdown > 0 ? report.netProfit / report.maxDrawdown : null,
    expectancy,
    calmar: report.maxDrawdownPercent > 0 ? finite(pinerMetrics.calmar) : null,
    exposurePercent: report.barsProcessed === 0 ? null : finite(pinerMetrics.exposurePercent),
    accountSizeRequired: capital.accountSizeRequired,
    marginCalls: report.marginCalls,
    peakMarginUsagePercent: capital.peakMarginUsagePercent,
    avgHoldingMs: mean(trades.map((t) => t.durationMs)),
    avgBarsInTrade: closed === 0 ? null : finite(pinerMetrics.avgBarsInTrade),
    long: directionStats(trades, "long"),
    short: directionStats(trades, "short"),
    periodsPerYear: pinerMetrics.periodsPerYear
  };
}

// src/strategy/strategyAdapter.ts
var MS_PER_SECOND = 1e3;
function directionOf(dir) {
  return dir >= 0 ? "long" : "short";
}
function tradePercent(amount, entryPrice, qty) {
  const basis = Math.abs(entryPrice * qty);
  return basis > 0 ? amount / basis * 100 : 0;
}
function barSeconds(candles, barIndex, fallbackMs) {
  const candle = candles[barIndex];
  return candle ? candle.time : Math.floor(fallbackMs / MS_PER_SECOND);
}
function buildTrades(report, candles) {
  return report.closedTrades.map((row, i) => {
    const netPnL = row.profit;
    const grossPnL = row.profit + row.commission;
    return {
      id: `${i}`,
      index: i + 1,
      entryId: row.entryId,
      direction: directionOf(row.dir),
      entryTime: barSeconds(candles, row.entryBar, row.entryTime),
      exitTime: barSeconds(candles, row.exitBar, row.exitTime),
      entryBarIndex: row.entryBar,
      exitBarIndex: row.exitBar,
      entryPrice: row.entryPrice,
      exitPrice: row.exitPrice,
      quantity: row.qty,
      grossPnL,
      commission: row.commission,
      netPnL,
      returnPercent: tradePercent(netPnL, row.entryPrice, row.qty),
      cumulativePnL: row.cumProfit,
      durationMs: Math.max(0, row.exitTime - row.entryTime),
      maxRunup: row.maxRunup,
      maxDrawdown: row.maxDrawdown
    };
  });
}
function buildOpenPosition(lots, candles) {
  if (lots.length === 0 || candles.length === 0) return null;
  const lastClose = candles[candles.length - 1].close;
  let size = 0;
  let notional = 0;
  let unrealized = 0;
  const trades = [];
  for (const lot of lots) {
    const qty = Math.abs(lot.size);
    const pnl = lot.size * (lastClose - lot.entryPrice);
    size += lot.size;
    notional += lot.entryPrice * qty;
    unrealized += pnl;
    trades.push({
      entryId: lot.entryId,
      direction: directionOf(lot.size),
      entryTime: barSeconds(candles, lot.entryBarIndex, lot.entryTime),
      entryBarIndex: lot.entryBarIndex,
      entryPrice: lot.entryPrice,
      quantity: qty,
      unrealizedPnL: pnl,
      returnPercent: tradePercent(pnl, lot.entryPrice, qty)
    });
  }
  const totalQty = lots.reduce((sum, lot) => sum + Math.abs(lot.size), 0);
  return {
    direction: directionOf(size),
    size,
    averageEntryPrice: totalQty > 0 ? notional / totalQty : 0,
    unrealizedPnL: unrealized,
    trades
  };
}
function buildEquityCurve(report, trades, candles) {
  const initial = report.initialCapital;
  const benchmark = buildBenchmarkCurve(candles, trades, initial);
  const realizedByBar = new Float64Array(candles.length);
  for (const trade of trades) {
    if (trade.exitBarIndex >= 0 && trade.exitBarIndex < realizedByBar.length) {
      realizedByBar[trade.exitBarIndex] += trade.netPnL;
    }
  }
  const points = [];
  let realized = 0;
  let peak = initial;
  let valley = initial;
  let last = initial;
  for (let i = 0; i < candles.length; i += 1) {
    realized += realizedByBar[i];
    const raw = report.equityCurve[i];
    const equity = Number.isFinite(raw) ? raw : last;
    last = equity;
    if (equity > peak) peak = equity;
    if (equity < valley) valley = equity;
    const drawdown = Math.max(0, peak - equity);
    const runup = Math.max(0, equity - valley);
    points.push({
      time: candles[i].time,
      equity,
      cash: initial + realized,
      realizedPnL: realized,
      unrealizedPnL: equity - initial - realized,
      drawdown,
      drawdownPercent: peak > 0 ? drawdown / peak * 100 : 0,
      runup,
      runupPercent: valley > 0 ? runup / valley * 100 : 0,
      benchmarkEquity: benchmark[i]
    });
  }
  return points;
}
function buildBenchmarkCurve(candles, trades, initialCapital) {
  if (candles.length === 0) return [];
  const entryBar = trades.length > 0 ? trades[0].entryBarIndex : Math.min(1, candles.length - 1);
  const basis = trades.length > 0 ? trades[0].entryPrice : candles[Math.min(1, candles.length - 1)].open;
  if (!Number.isFinite(basis) || basis <= 0) return candles.map(() => initialCapital);
  return candles.map(
    (candle, i) => i < entryBar ? initialCapital : initialCapital * (candle.close / basis)
  );
}
function buildPositions(trades, openLots, candles) {
  const n = candles.length;
  const signedSize = new Float64Array(n + 1);
  const notional = new Float64Array(n + 1);
  const realizedByBar = new Float64Array(n + 1);
  const addLot = (from, to, signed, price) => {
    const start = Math.max(0, Math.min(from, n));
    const end = Math.max(0, Math.min(to, n));
    if (start >= end) return;
    const qty = Math.abs(signed);
    signedSize[start] += signed;
    signedSize[end] -= signed;
    notional[start] += price * qty;
    notional[end] -= price * qty;
  };
  for (const trade of trades) {
    const signed = trade.direction === "long" ? trade.quantity : -trade.quantity;
    addLot(trade.entryBarIndex, trade.exitBarIndex, signed, trade.entryPrice);
    if (trade.exitBarIndex >= 0 && trade.exitBarIndex <= n) realizedByBar[trade.exitBarIndex] += trade.netPnL;
  }
  for (const lot of openLots) {
    addLot(lot.entryBarIndex, n, lot.size, lot.entryPrice);
  }
  const snapshots = [];
  let size = 0;
  let runningNotional = 0;
  let realized = 0;
  for (let i = 0; i < n; i += 1) {
    size += signedSize[i];
    runningNotional += notional[i];
    realized += realizedByBar[i];
    const qty = Math.abs(size);
    const flat = qty < 1e-9;
    const averageEntryPrice = flat ? 0 : runningNotional / qty;
    const close = candles[i].close;
    snapshots.push({
      time: candles[i].time,
      barIndex: i,
      size: flat ? 0 : size,
      direction: flat ? "flat" : size > 0 ? "long" : "short",
      averageEntryPrice,
      currentPrice: close,
      unrealizedPnL: flat ? 0 : (close - averageEntryPrice) * size,
      realizedPnL: realized
    });
  }
  return snapshots;
}

// server/strategy/unsupported.ts
import { ExecutionContext, tokenize } from "@heyphat/piner";
var supportedMembers = null;
function membersOfStrategyNamespace() {
  if (!supportedMembers) {
    supportedMembers = new Set(Object.keys(new ExecutionContext().strategy));
  }
  return supportedMembers;
}
function findUnsupportedStrategyCalls(source) {
  let tokens;
  try {
    tokens = tokenize(source).tokens;
  } catch {
    return [];
  }
  const supported = membersOfStrategyNamespace();
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < tokens.length - 2; i += 1) {
    const [head, dot, member] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (String(head.kind) !== "Ident" || head.value !== "strategy") continue;
    if (dot.value !== "." || String(member.kind) !== "Ident") continue;
    if (supported.has(member.value)) continue;
    const name = `strategy.${member.value}`;
    if (seen.has(name)) continue;
    seen.add(name);
    found.push({ name, line: member.line, col: member.col });
  }
  return found;
}
function describeUnsupported(features) {
  const list = features.map((f) => `  ${f.name}  (line ${f.line})`).join("\n");
  return `This strategy uses:
${list}

Those features are not supported by the execution engine, and calls to them would be silently ignored \u2014 the backtest was not run.`;
}

// server/strategy/executor.ts
function toStrategySettings(config) {
  return {
    initialCapital: config.initialCapital,
    qtyType: config.qtyType,
    qtyValue: config.qtyValue,
    commissionType: config.commissionType,
    commissionValue: config.commissionValue,
    slippage: config.slippage,
    pyramiding: config.pyramiding,
    processOrdersOnClose: config.processOrdersOnClose,
    marginLong: config.marginLong,
    marginShort: config.marginShort
  };
}
function sliceCandles(candles, from, to) {
  if (from === null && to === null) return candles;
  return candles.filter((c) => (from === null || c.time >= from) && (to === null || c.time <= to));
}
async function executeStrategy(args) {
  const { compiled: compiled2, config } = args;
  const candles = sliceCandles(args.candles, config.from, config.to);
  if (candles.length === 0) {
    return {
      result: null,
      outputs: null,
      drawings: [],
      candles,
      error: {
        heading: "Invalid Data",
        message: args.candles.length === 0 ? "No historical bars are loaded." : "The selected date range contains no bars. Widen the range and run again."
      }
    };
  }
  const unsupported = args.source === void 0 ? [] : findUnsupportedStrategyCalls(args.source);
  if (unsupported.length > 0) {
    return {
      result: null,
      outputs: null,
      drawings: [],
      candles,
      error: { heading: "Unsupported strategy feature", message: describeUnsupported(unsupported) }
    };
  }
  const startedAt = performance.now();
  const outcome = await runScript(compiled2, toPinerBars(candles), args.inputs, {
    symbol: args.symbol,
    timeframe: args.timeframe,
    mintick: config.mintick,
    strategy: toStrategySettings(config)
  });
  if (outcome.error) {
    return { result: null, outputs: null, drawings: [], candles, error: outcome.error };
  }
  if (!outcome.strategy) {
    return {
      result: null,
      outputs: outcome.outputs,
      drawings: outcome.drawings,
      candles,
      error: {
        heading: "Not a Strategy",
        message: "This script declares indicator(), so it produces no orders, trades or equity curve."
      }
    };
  }
  const { report, metrics, openLots } = outcome.strategy;
  const trades = buildTrades(report, candles);
  const openPosition = buildOpenPosition(openLots, candles);
  const equityCurve = buildEquityCurve(report, trades, candles);
  const positions = buildPositions(trades, openLots, candles);
  return {
    result: {
      title: compiled2.metadata.title,
      symbol: args.symbol,
      timeframe: args.timeframe,
      barCount: candles.length,
      firstBarTime: candles[0].time,
      lastBarTime: candles[candles.length - 1].time,
      trades,
      openPosition,
      equityCurve,
      positions,
      phases: equityPhases(equityCurve),
      summary: computeSummary(report, metrics, trades, equityCurve, positions, openPosition, config),
      report,
      pinerMetrics: metrics,
      elapsedMs: performance.now() - startedAt
    },
    outputs: outcome.outputs,
    drawings: outcome.drawings,
    candles,
    error: null
  };
}

// server/pine/compiler.ts
import {
  CompileError,
  LexError,
  ParseError,
  compile,
  parse as parse2,
  tokenize as tokenize4
} from "@heyphat/piner";

// server/pine/security.ts
import { parse, tokenize as tokenize2 } from "@heyphat/piner";
var isIdent = (t) => t !== void 0 && String(t.kind) === "Ident";
var OPENERS = /* @__PURE__ */ new Set(["(", "["]);
var CLOSERS = /* @__PURE__ */ new Set([")", "]"]);
var CONTAINER_NS = /* @__PURE__ */ new Set(["array", "matrix", "map"]);
var CONTAINER_FNS = /* @__PURE__ */ new Set(["new", "from", "copy"]);
var isContainerCtor = (property) => CONTAINER_FNS.has(property) || property.startsWith("new_");
function collectScope(body) {
  const scope = { types: /* @__PURE__ */ new Set(), funcs: /* @__PURE__ */ new Map(), globals: /* @__PURE__ */ new Map() };
  for (const stmt of body) {
    if (stmt.kind === "TypeDef") scope.types.add(stmt.name);
    else if (stmt.kind === "FuncDef") scope.funcs.set(stmt.name, stmt);
    else if (stmt.kind === "VarDecl") scope.globals.set(stmt.name, stmt);
  }
  return scope;
}
function localDecls(body, into = /* @__PURE__ */ new Map()) {
  for (const stmt of body) {
    if (stmt.kind === "VarDecl") into.set(stmt.name, stmt);
    for (const value of Object.values(stmt)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null && "kind" in value[0]) {
        localDecls(value, into);
      }
    }
  }
  return into;
}
function resultOf(func) {
  const last = func.body[func.body.length - 1];
  if (!last) return null;
  if (last.kind === "ExprStmt") return last.expr;
  if (last.kind === "VarDecl") return last.init;
  if (last.kind === "Reassign") return last.value;
  return null;
}
var OBJECT_TYPES = /* @__PURE__ */ new Set(["array", "matrix", "map", "udt"]);
function returnsObject(expr, scope, locals, visited) {
  if (!expr || visited.size > 16) return false;
  switch (expr.kind) {
    case "History":
      return returnsObject(expr.base, scope, locals, visited);
    case "Ternary":
      return returnsObject(expr.then, scope, locals, visited) || returnsObject(expr.else, scope, locals, visited);
    case "Ident": {
      const decl = locals.get(expr.name) ?? scope.globals.get(expr.name);
      if (!decl || visited.has(`v:${expr.name}`)) return false;
      if (decl.declType && OBJECT_TYPES.has(decl.declType.kind)) return true;
      return returnsObject(decl.init, scope, locals, /* @__PURE__ */ new Set([...visited, `v:${expr.name}`]));
    }
    case "Call": {
      const callee = expr.callee;
      if (callee.kind === "Member" && callee.object.kind === "Ident") {
        const ns = callee.object.name;
        if (CONTAINER_NS.has(ns) && isContainerCtor(callee.property)) return true;
        if (scope.types.has(ns) && callee.property === "new") return true;
        if (ns === "request" && callee.property.startsWith("security")) {
          return returnsObject(expr.args[2]?.value, scope, locals, visited);
        }
      }
      if (callee.kind === "Ident") {
        const func = scope.funcs.get(callee.name);
        if (!func || visited.has(`f:${callee.name}`)) return false;
        return returnsObject(resultOf(func), scope, localDecls(func.body), /* @__PURE__ */ new Set([...visited, `f:${callee.name}`]));
      }
      return false;
    }
    default:
      return false;
  }
}
function objectSecuritySites(source) {
  const sites = /* @__PURE__ */ new Set();
  let program;
  try {
    program = parse(tokenize2(source));
  } catch {
    return sites;
  }
  const scope = collectScope(program.body);
  const walk = (node, locals) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, locals);
      return;
    }
    const typed = node;
    const inner = typed.kind === "FuncDef" ? localDecls(typed.body ?? []) : locals;
    if (typed.kind === "Call") {
      const call = node;
      const callee = call.callee;
      if (callee.kind === "Member" && callee.object.kind === "Ident" && callee.object.name === "request" && callee.property === "security" && callee.object.loc && isSelfSymbol(call.args[0]?.value) && returnsObject(call.args[2]?.value, scope, inner, /* @__PURE__ */ new Set())) {
        sites.add(`${callee.object.loc.line}:${callee.object.loc.col}`);
      }
    }
    for (const value of Object.values(node)) walk(value, inner);
  };
  walk(program.body, /* @__PURE__ */ new Map());
  return sites;
}
function isSelfSymbol(expr) {
  if (!expr) return false;
  if (expr.kind === "String") return expr.value === "";
  return expr.kind === "Member" && expr.object.kind === "Ident" && expr.object.name === "syminfo" && (expr.property === "tickerid" || expr.property === "ticker");
}
function matchBracket(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (OPENERS.has(tokens[i].value)) depth += 1;
    else if (CLOSERS.has(tokens[i].value)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function argSpans(tokens, open, close) {
  const spans = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const v = tokens[i].value;
    if (OPENERS.has(v)) depth += 1;
    else if (CLOSERS.has(v)) depth -= 1;
    else if (v === "," && depth === 0) {
      spans.push([start, i - 1]);
      start = i + 1;
    }
  }
  spans.push([start, close - 1]);
  return spans;
}
function spanText(lines, tokens, [from, to]) {
  const first = tokens[from];
  const last = tokens[to];
  return lines[first.line - 1].slice(first.col - 1, last.col - 1 + last.value.length);
}
function unwrapOnce(source) {
  let tokens;
  try {
    tokens = tokenize2(source).tokens;
  } catch {
    return { source, unwrapped: 0 };
  }
  const sites = objectSecuritySites(source);
  if (sites.size === 0) return { source, unwrapped: 0 };
  const lines = source.split("\n");
  const edits = [];
  for (let i = 0; i < tokens.length - 3; i += 1) {
    if (!isIdent(tokens[i]) || tokens[i].value !== "request") continue;
    if (tokens[i + 1].value !== "." || tokens[i + 2].value !== "security" || tokens[i + 3].value !== "(") continue;
    if (!sites.has(`${tokens[i].line}:${tokens[i].col}`)) continue;
    const open = i + 3;
    const close = matchBracket(tokens, open);
    if (close === -1 || tokens[close].line !== tokens[i].line) continue;
    const spans = argSpans(tokens, open, close);
    if (spans.length < 3) continue;
    if (spans.some(([from, to]) => tokens.slice(from, to + 1).some((t) => t.value === "="))) continue;
    const exprSpan = spans[2];
    edits.push({
      line: tokens[i].line,
      from: tokens[i].col,
      to: tokens[close].col + 1,
      text: spanText(lines, tokens, exprSpan)
    });
  }
  if (edits.length === 0) return { source, unwrapped: 0 };
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    const text = lines[edit.line - 1];
    lines[edit.line - 1] = `${text.slice(0, edit.from - 1)}${edit.text}${text.slice(edit.to - 1)}`;
  }
  return { source: lines.join("\n"), unwrapped: edits.length };
}
function unwrapSelfSecurity(source) {
  let current = source;
  let total = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const { source: next, unwrapped } = unwrapOnce(current);
    if (unwrapped === 0) break;
    current = next;
    total += unwrapped;
  }
  return { source: current, unwrapped: total };
}
function describeSecurityUnwrap(count) {
  return `${count} request.security() call${count === 1 ? "" : "s"} on this symbol returned an array, map, matrix or user-defined type. This engine hands those back as one live reference \u2014 the same value on every bar, at any timeframe \u2014 so the script would run on a frozen input and draw almost nothing. The wrapper has been dropped and the expression is evaluated directly, which is what TradingView does when the timeframe argument is empty or equal to the chart's. If the call requested a HIGHER timeframe, the values are the chart's timeframe instead of resampled. Numeric request.security() calls are untouched: those resample correctly.`;
}

// server/pine/udtHistory.ts
import { tokenize as tokenize3 } from "@heyphat/piner";
var CONDITIONAL_OPENERS = /* @__PURE__ */ new Set(["if", "else", "switch"]);
var isIdent2 = (t) => t !== void 0 && String(t.kind) === "Ident";
var STRUCTURAL = /* @__PURE__ */ new Set(["Newline", "Indent", "Dedent", "EOF"]);
var isCode = (t) => !STRUCTURAL.has(String(t.kind)) && t.value !== "";
function declaredTypes(tokens) {
  const types = /* @__PURE__ */ new Set();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i].value === "type" && isIdent2(tokens[i + 1]) && tokens[i].col === 1) {
      types.add(tokens[i + 1].value);
    }
  }
  return types;
}
var PERSISTENT = /* @__PURE__ */ new Set(["var", "varip"]);
function udtVariables(tokens, types) {
  const vars = /* @__PURE__ */ new Map();
  for (let i = 0; i < tokens.length - 2; i += 1) {
    const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    if (isIdent2(a) && types.has(a.value) && isIdent2(b) && c.value === "=" && !vars.has(b.value)) {
      vars.set(b.value, { line: a.line, persistent: PERSISTENT.has(tokens[i - 1]?.value ?? "") });
    }
    if (isIdent2(a) && b.value === "=" && isIdent2(c) && types.has(c.value) && tokens[i + 3]?.value === "." && !vars.has(a.value)) {
      vars.set(a.value, { line: a.line, persistent: PERSISTENT.has(tokens[i - 1]?.value ?? "") });
    }
  }
  return vars;
}
function lineIndents(tokens) {
  const indents = /* @__PURE__ */ new Map();
  for (const t of tokens) {
    if (!isCode(t)) continue;
    const seen = indents.get(t.line);
    if (seen === void 0 || t.col < seen) indents.set(t.line, t.col);
  }
  return indents;
}
function lineHeads(tokens) {
  const heads = /* @__PURE__ */ new Map();
  const indents = lineIndents(tokens);
  for (const t of tokens) {
    if (isCode(t) && t.col === indents.get(t.line)) heads.set(t.line, t.value);
  }
  return heads;
}
function insideConditional(line, indents, heads) {
  let indent = indents.get(line);
  if (indent === void 0 || indent === 1) return false;
  for (let probe = line - 1; probe >= 1; probe -= 1) {
    const probeIndent = indents.get(probe);
    if (probeIndent === void 0 || probeIndent >= indent) continue;
    if (CONDITIONAL_OPENERS.has(heads.get(probe) ?? "")) return true;
    indent = probeIndent;
    if (indent === 1) break;
  }
  return false;
}
function occurrences(source, tokens) {
  const types = declaredTypes(tokens);
  if (types.size === 0) return [];
  const vars = udtVariables(tokens, types);
  if (vars.size === 0) return [];
  const indents = lineIndents(tokens);
  const heads = lineHeads(tokens);
  const lines = source.split("\n");
  const found = [];
  for (let i = 0; i < tokens.length - 3; i += 1) {
    const [recv, dot, field, open] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (!isIdent2(recv) || !vars.has(recv.value)) continue;
    if (dot.value !== "." || !isIdent2(field) || open.value !== "[") continue;
    let depth = 0;
    let close = -1;
    for (let j = i + 3; j < tokens.length; j += 1) {
      if (tokens[j].value === "[") depth += 1;
      else if (tokens[j].value === "]") {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1 || tokens[close].line !== recv.line) continue;
    const indexTokens = tokens.slice(i + 4, close);
    const index = lines[recv.line - 1].slice(open.col, tokens[close].col - 1);
    const decl = vars.get(recv.value);
    const single = indexTokens.length === 1 ? indexTokens[0] : void 0;
    found.push({
      recv: recv.value,
      field: field.value,
      index,
      line: recv.line,
      startCol: recv.col,
      endCol: tokens[close].col + 1,
      conditional: insideConditional(recv.line, indents, heads),
      constIndex: single !== void 0 && String(single.kind) === "Int",
      mirrorable: !decl.persistent && recv.line > decl.line,
      declLine: decl.line
    });
  }
  return found;
}
function rewriteConditionalUdtHistory(source) {
  let tokens;
  try {
    tokens = tokenize3(source).tokens;
  } catch {
    return { source, hoisted: 0, remaining: [] };
  }
  const suspect = (o) => o.conditional || !o.constIndex;
  const all = occurrences(source, tokens);
  const targets = all.filter((o) => suspect(o) && o.mirrorable);
  const remaining = all.filter((o) => suspect(o) && !o.mirrorable).map((o) => ({ name: `${o.recv}.${o.field}`, line: o.line, col: o.startCol }));
  if (targets.length === 0) return { source, hoisted: 0, remaining: dedupe(remaining) };
  const taken = new Set(tokens.filter((t) => isIdent2(t)).map((t) => t.value));
  const names = /* @__PURE__ */ new Map();
  const mirrorsByLine = /* @__PURE__ */ new Map();
  for (const o of targets) {
    const key = `${o.recv}.${o.field}`;
    if (names.has(key)) continue;
    let name = `_h_${o.recv}_${o.field}`;
    for (let n = 1; taken.has(name); n += 1) name = `_h${n}_${o.recv}_${o.field}`;
    taken.add(name);
    names.set(key, name);
    mirrorsByLine.set(o.declLine, [...mirrorsByLine.get(o.declLine) ?? [], `${name} = ${key}`]);
  }
  const lines = source.split("\n");
  const byLine = /* @__PURE__ */ new Map();
  for (const o of targets) byLine.set(o.line, [...byLine.get(o.line) ?? [], o]);
  for (const [line, occs] of byLine) {
    let text = lines[line - 1];
    for (const o of [...occs].sort((a, b) => b.startCol - a.startCol)) {
      const name = names.get(`${o.recv}.${o.field}`);
      const indexed = text.slice(o.startCol - 1, o.endCol - 1);
      text = `${text.slice(0, o.startCol - 1)}${name}${indexed.slice(indexed.indexOf("["))}${text.slice(o.endCol - 1)}`;
    }
    lines[line - 1] = text;
  }
  for (const [line, mirrors] of mirrorsByLine) {
    const text = lines[line - 1];
    const cr = text.endsWith("\r") ? "\r" : "";
    lines[line - 1] = `${cr ? text.slice(0, -1) : text}, ${mirrors.join(", ")}${cr}`;
  }
  return { source: lines.join("\n"), hoisted: names.size, remaining: dedupe(remaining) };
}
function dedupe(reads) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of reads) {
    const key = `${r.name}@${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
function describeUdtHistory(reads) {
  const list = reads.map((r) => `  ${r.name}[\u2026]  (line ${r.line})`).join("\n");
  return `History of a user-defined type's field is read where this engine cannot serve it:
${list}

The series behind a UDT field is only written on bars where the line executes, and it is only indexable by a literal offset, so inside an if/else \u2014 or with a variable offset like [i] \u2014 the read returns na, which nz() then turns into 0, silently. Assign the field to a plain variable at global scope (x = b.h) and index that instead (x[i]). These reads could not be rewritten automatically because the receiver is declared with var, or is used above its own declaration.`;
}

// server/pine/compiler.ts
var OVERLAY_ARG_INDEX = 2;
var DECLARATION_FNS = /* @__PURE__ */ new Set(["indicator", "strategy"]);
function positionalOverlay(source) {
  let program;
  try {
    program = parse2(tokenize4(source));
  } catch {
    return null;
  }
  for (const stmt of program.body) {
    if (stmt.kind !== "ExprStmt") continue;
    const call = stmt.expr;
    if (call.kind !== "Call" || call.callee.kind !== "Ident") continue;
    if (!DECLARATION_FNS.has(call.callee.name)) continue;
    const positional = call.args.filter((arg) => arg.name === void 0);
    const overlay = positional[OVERLAY_ARG_INDEX]?.value;
    return overlay?.kind === "Bool" ? overlay.value : null;
  }
  return null;
}
var LEGACY_NAMESPACED_FNS = new Map([
  ...[
    "abs",
    "acos",
    "asin",
    "atan",
    "avg",
    "ceil",
    "cos",
    "exp",
    "floor",
    "log",
    "log10",
    "max",
    "min",
    "pow",
    "round",
    "sign",
    "sin",
    "sqrt",
    "tan"
  ].map((name) => [name, "math"]),
  ...[
    "accdist",
    "alma",
    "atr",
    "barssince",
    "bb",
    "bbw",
    "cci",
    "change",
    "cmo",
    "cog",
    "correlation",
    "cross",
    "crossover",
    "crossunder",
    "cum",
    "dev",
    "dmi",
    "ema",
    "falling",
    "highest",
    "highestbars",
    "hma",
    "iii",
    "kc",
    "kcw",
    "linreg",
    "lowest",
    "lowestbars",
    "macd",
    "median",
    "mfi",
    "mom",
    "nvi",
    "obv",
    "percentile_linear_interpolation",
    "percentile_nearest_rank",
    "percentrank",
    "pivot_point_levels",
    "pivothigh",
    "pivotlow",
    "pvi",
    "pvt",
    "rci",
    "rising",
    "rma",
    "roc",
    "rsi",
    "sar",
    "sma",
    "stdev",
    "stoch",
    "supertrend",
    "swma",
    "tr",
    "tsi",
    "valuewhen",
    "variance",
    "vwap",
    "vwma",
    "wad",
    "wma",
    "wpr",
    "wvad"
  ].map((name) => [name, "ta"])
]);
function rewriteLegacyBuiltins(source) {
  let tokens;
  try {
    tokens = tokenize4(source).tokens;
  } catch {
    return source;
  }
  const perLine = /* @__PURE__ */ new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== "Ident") continue;
    const ns = LEGACY_NAMESPACED_FNS.get(t.value);
    if (!ns) continue;
    if (tokens[i - 1]?.value === ".") continue;
    if (tokens[i + 1]?.value !== "(") continue;
    const spots = perLine.get(t.line) ?? [];
    spots.push({ col: t.col, len: t.value.length, ns });
    perLine.set(t.line, spots);
  }
  if (perLine.size === 0) return source;
  const lines = source.split("\n");
  for (const [lineNo, spots] of perLine) {
    let line = lines[lineNo - 1];
    spots.sort((a, b) => b.col - a.col);
    for (const { col, len, ns } of spots) {
      const idx = col - 1;
      line = `${line.slice(0, idx)}${ns}.${line.slice(idx, idx + len)}${line.slice(idx + len)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join("\n");
}
function rewriteStudyToIndicator(source) {
  let tokens;
  try {
    tokens = tokenize4(source).tokens;
  } catch {
    return source;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== "Ident" || t.value !== "study") continue;
    if (tokens[i - 1]?.value === "." || tokens[i + 1]?.value !== "(") continue;
    const lines = source.split("\n");
    const idx = t.col - 1;
    const line = lines[t.line - 1];
    lines[t.line - 1] = `${line.slice(0, idx)}indicator${line.slice(idx + "study".length)}`;
    return lines.join("\n");
  }
  return source;
}
var PLOT_PARAMS = [
  "series",
  "title",
  "color",
  "linewidth",
  "style",
  "trackprice",
  "histbase",
  "offset",
  "join",
  "editable",
  "show_last",
  "display",
  "format",
  "precision",
  "force_overlay"
];
var FIRST_UNREAD_PLOT_ARG = 3;
var STRUCTURAL_KINDS = /* @__PURE__ */ new Set(["Newline", "Indent", "Dedent", "EOF"]);
function rewritePositionalPlotArgs(source) {
  let tokens;
  try {
    tokens = tokenize4(source).tokens;
  } catch {
    return source;
  }
  const isCode2 = (t) => !STRUCTURAL_KINDS.has(String(t.kind)) && t.value !== "";
  const inserts = [];
  const nameArg = (from, to, index) => {
    if (index < FIRST_UNREAD_PLOT_ARG || index >= PLOT_PARAMS.length) return;
    const head = tokens.slice(from, to).findIndex(isCode2);
    if (head === -1) return;
    const first = tokens[from + head];
    const next = tokens.slice(from + head + 1, to).find(isCode2);
    if (String(first.kind) === "Ident" && next?.value === "=") return;
    inserts.push({ line: first.line, col: first.col, text: `${PLOT_PARAMS[index]} = ` });
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (String(t.kind) !== "Ident" || t.value !== "plot") continue;
    if (tokens[i - 1]?.value === "." || tokens[i + 1]?.value !== "(") continue;
    let depth = 0;
    let index = 0;
    let start = i + 2;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const v = tokens[j].value;
      if (v === "(" || v === "[") depth += 1;
      else if (v === ")" || v === "]") {
        depth -= 1;
        if (depth === 0) {
          nameArg(start, j, index);
          break;
        }
      } else if (v === "," && depth === 1) {
        nameArg(start, j, index);
        index += 1;
        start = j + 1;
      }
    }
  }
  if (inserts.length === 0) return source;
  const lines = source.split("\n");
  const byLine = /* @__PURE__ */ new Map();
  for (const ins of inserts) byLine.set(ins.line, [...byLine.get(ins.line) ?? [], ins]);
  for (const [lineNo, spots] of byLine) {
    let line = lines[lineNo - 1];
    for (const { col, text } of [...spots].sort((a, b) => b.col - a.col)) {
      line = `${line.slice(0, col - 1)}${text}${line.slice(col - 1)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join("\n");
}
function rewriteShadowedColor(source) {
  let tokens;
  try {
    tokens = tokenize4(source).tokens;
  } catch {
    return source;
  }
  const isStatementStart = (i) => {
    const prev = tokens[i - 1];
    return !prev || String(prev.kind) === "Newline" || prev.value === "var" || prev.value === "varip";
  };
  const declaresColor = tokens.some(
    (t, i) => t.value === "color" && isStatementStart(i) && (tokens[i + 1]?.value === "=" || tokens[i + 1]?.value === ":=")
  );
  if (!declaresColor) return source;
  const taken = new Set(tokens.filter((t) => String(t.kind) === "Ident").map((t) => t.value));
  let name = "_clr_";
  for (let n = 1; taken.has(name); n += 1) name = `_clr${n}`;
  const perLine = /* @__PURE__ */ new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.value !== "color") continue;
    const next = tokens[i + 1];
    if (next?.value === ".") continue;
    if (String(next?.kind) === "Ident") continue;
    if (next?.value === "=" && !isStatementStart(i)) continue;
    perLine.set(t.line, [...perLine.get(t.line) ?? [], t.col]);
  }
  if (perLine.size === 0) return source;
  const lines = source.split("\n");
  for (const [lineNo, cols] of perLine) {
    let line = lines[lineNo - 1];
    for (const col of cols) {
      const idx = col - 1;
      line = `${line.slice(0, idx)}${name}${line.slice(idx + "color".length)}`;
    }
    lines[lineNo - 1] = line;
  }
  return lines.join("\n");
}
function compileScript(source) {
  try {
    const patched = rewriteConditionalUdtHistory(
      unwrapSelfSecurity(
        rewritePositionalPlotArgs(rewriteShadowedColor(rewriteLegacyBuiltins(rewriteStudyToIndicator(source))))
      ).source
    ).source;
    const compiled2 = compile(patched);
    const overlay = positionalOverlay(patched);
    if (overlay !== null) compiled2.metadata.overlay = overlay;
    const hasError = compiled2.diagnostics.some((d) => d.severity === "error");
    if (hasError) {
      const first = compiled2.diagnostics.find((d) => d.severity === "error");
      return {
        compiled: null,
        diagnostics: compiled2.diagnostics,
        error: {
          heading: "Compilation Error",
          message: first.message,
          line: first.line,
          col: first.col
        }
      };
    }
    return { compiled: compiled2, diagnostics: compiled2.diagnostics, error: null };
  } catch (err) {
    return { compiled: null, diagnostics: [], error: toCompileError(err) };
  }
}
function toCompileError(err) {
  if (err instanceof CompileError) {
    const first = err.diagnostics[0];
    return {
      heading: "Compilation Error",
      message: err.message,
      line: first?.line,
      col: first?.col
    };
  }
  if (err instanceof LexError || err instanceof ParseError) {
    return {
      heading: "Compilation Error",
      message: err.message,
      line: err.line,
      col: err.col
    };
  }
  return {
    heading: "Compilation Error",
    message: err instanceof Error ? err.message : String(err)
  };
}

// server/pine/cache.ts
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
var MAX_COMPILED = 50;
var MAX_RESULTS = 40;
var ENGINE_VERSION = readEngineVersion();
function readEngineVersion() {
  try {
    const require2 = createRequire(import.meta.url);
    const entry = require2.resolve("@heyphat/piner");
    const manifest = entry.replace(/dist[\\/].*$/, "package.json");
    return require2(manifest).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
var Lru = class {
  entries = /* @__PURE__ */ new Map();
  max;
  constructor(max) {
    this.max = max;
  }
  get(key) {
    const hit = this.entries.get(key);
    if (hit !== void 0) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }
  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
  clear() {
    this.entries.clear();
  }
};
var compiled = new Lru(MAX_COMPILED);
var results = new Lru(MAX_RESULTS);
function digest(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function compileKey(source) {
  return digest([ENGINE_VERSION, source]);
}
function resultKey(parts) {
  return digest([
    ENGINE_VERSION,
    parts.source,
    parts.symbol,
    parts.timeframe,
    parts.dataset,
    parts.inputs,
    parts.strategy
  ]);
}
var compileCache = {
  get: (key) => compiled.get(key),
  set: (key, value) => compiled.set(key, value)
};
var resultCache = {
  get: (key) => results.get(key),
  set: (key, value) => results.set(key, value)
};

// src/strategy/types.ts
var DEFAULT_STRATEGY_CONFIG = {
  initialCapital: 1e5,
  qtyType: "fixed",
  qtyValue: 1,
  commissionType: "percent",
  commissionValue: 0,
  slippage: 0,
  mintick: 0.01,
  pyramiding: 1,
  processOrdersOnClose: false,
  marginLong: 100,
  marginShort: 100,
  from: null,
  to: null
};

// src/types/pine.ts
function serializeOutputs(outputs) {
  return {
    plots: [...outputs.plots],
    markers: [...outputs.markers],
    candles: [...outputs.candles],
    hlines: [...outputs.hlines],
    fills: [...outputs.fills],
    barColors: [...outputs.barColors],
    bgColors: [...outputs.bgColors]
  };
}
function emptyOutputs() {
  return {
    plots: /* @__PURE__ */ new Map(),
    markers: /* @__PURE__ */ new Map(),
    candles: /* @__PURE__ */ new Map(),
    hlines: /* @__PURE__ */ new Map(),
    fills: /* @__PURE__ */ new Map(),
    barColors: /* @__PURE__ */ new Map(),
    bgColors: /* @__PURE__ */ new Map()
  };
}

// server/pine/executor.ts
var PineFailure = class extends Error {
  status;
  pine;
  constructor(pine, status = 422) {
    super(pine.message);
    this.name = "PineFailure";
    this.pine = pine;
    this.status = status;
  }
};
function resolveStrategyConfig(compiled2, overrides) {
  const header = compiled2.metadata.strategy ?? {};
  return {
    ...DEFAULT_STRATEGY_CONFIG,
    ...header.initialCapital !== void 0 ? { initialCapital: header.initialCapital } : {},
    ...header.qtyType !== void 0 ? { qtyType: header.qtyType } : {},
    ...header.qtyValue !== void 0 ? { qtyValue: header.qtyValue } : {},
    ...header.commissionType !== void 0 ? { commissionType: header.commissionType } : {},
    ...header.commissionValue !== void 0 ? { commissionValue: header.commissionValue } : {},
    ...header.slippage !== void 0 ? { slippage: header.slippage } : {},
    ...header.pyramiding !== void 0 ? { pyramiding: header.pyramiding } : {},
    ...header.processOrdersOnClose !== void 0 ? { processOrdersOnClose: header.processOrdersOnClose } : {},
    ...header.marginLong !== void 0 ? { marginLong: header.marginLong } : {},
    ...header.marginShort !== void 0 ? { marginShort: header.marginShort } : {},
    ...overrides ?? {}
  };
}
function compileCached(source) {
  const key = compileKey(source);
  const hit = compileCache.get(key);
  if (hit) return hit;
  const outcome = compileScript(source);
  if (outcome.error || !outcome.compiled) {
    throw new PineFailure(outcome.error ?? { heading: "Compilation Error", message: "The script did not compile." });
  }
  compileCache.set(key, outcome.compiled);
  return outcome.compiled;
}
function securityWarnings(compiled2) {
  const deps = compiled2.metadata.securityDependencies ?? [];
  if (deps.length === 0) return [];
  const lowerTf = deps.some((d) => d.lowerTf);
  const crossSymbol = deps.some((d) => !d.lowerTf && d.self === false);
  const selfSymbol = deps.some((d) => !d.lowerTf && d.self !== false);
  const out = [];
  if (lowerTf) {
    out.push({
      severity: "warning",
      line: 0,
      col: 0,
      message: "This script calls request.security_lower_tf() for intrabar data. This service serves a single timeframe per symbol and has no lower-timeframe bars to supply, so those calls return empty. Any output gated on them (labels, volume-delta readouts) will be missing."
    });
  }
  if (crossSymbol) {
    out.push({
      severity: "warning",
      line: 0,
      col: 0,
      message: "This script calls request.security() for a DIFFERENT symbol. This service loads one symbol per run and does not fetch or inject the other one, so those calls return na and anything derived from them will be missing."
    });
  }
  if (selfSymbol) {
    out.push({
      severity: "warning",
      line: 0,
      col: 0,
      message: "This script wraps its calculation in request.security() on its own symbol. That works for builtin series (close, ta.atr(...)), but an expression that reads a USER-DEFINED variable is captured on the first bar and never updates \u2014 plots come out as one flat line. If that is what you see, call the function directly instead: with an empty timeframe the request.security() wrapper is a no-op anyway."
    });
  }
  return out;
}
function metaOf(compiled2) {
  return {
    title: compiled2.metadata.title,
    overlay: compiled2.metadata.overlay,
    isStrategy: compiled2.metadata.isStrategy,
    inputs: [...compiled2.metadata.inputs],
    strategyHeader: compiled2.metadata.strategy ?? {}
  };
}
function rangeOf(all, window) {
  if (window.length === 0) return { start: 0, end: -1 };
  const start = all.indexOf(window[0]);
  return start === -1 ? { start: 0, end: window.length - 1 } : { start, end: start + window.length - 1 };
}
async function executePine(req) {
  const full = await loadSymbol(req.symbol);
  const candles = recentBars(full, req.bars);
  if (candles.length === 0) {
    throw new DatasetError(`No bars available for '${req.symbol}'.`, 422);
  }
  const key = resultKey({
    source: req.script,
    symbol: req.symbol,
    timeframe: req.timeframe,
    dataset: fingerprint(candles),
    inputs: req.inputs ?? {},
    strategy: req.strategy ?? {}
  });
  const cached = resultCache.get(key);
  if (cached) return { ...cached, cached: true };
  const compiled2 = compileCached(req.script);
  const meta = metaOf(compiled2);
  const udtReads = rewriteConditionalUdtHistory(req.script).remaining;
  const unwrapped = unwrapSelfSecurity(req.script).unwrapped;
  const diagnostics = [
    ...compiled2.diagnostics.filter((d) => d.severity !== "error"),
    ...securityWarnings(compiled2),
    ...unwrapped > 0 ? [{ severity: "warning", line: 0, col: 0, message: describeSecurityUnwrap(unwrapped) }] : [],
    ...udtReads.length > 0 ? [{ severity: "warning", line: udtReads[0].line, col: udtReads[0].col, message: describeUdtHistory(udtReads) }] : []
  ];
  const inputs = req.inputs ?? {};
  const startedAt = performance.now();
  const response = compiled2.metadata.isStrategy ? await runStrategy(compiled2, meta, diagnostics, candles, inputs, req) : await runIndicator(compiled2, meta, diagnostics, candles, inputs, req);
  response.elapsedMs = performance.now() - startedAt;
  resultCache.set(key, response);
  return response;
}
async function runIndicator(compiled2, meta, diagnostics, candles, inputs, req) {
  const outcome = await runScript(compiled2, toPinerBars(candles), inputs ?? {}, {
    symbol: req.symbol,
    timeframe: req.timeframe
  });
  if (outcome.error) throw new PineFailure(outcome.error);
  return {
    meta,
    diagnostics,
    outputs: outcome.outputs ? serializeOutputs(outcome.outputs) : serializeOutputs(emptyOutputs()),
    drawings: [...outcome.drawings],
    strategy: null,
    strategyConfig: null,
    range: { start: 0, end: candles.length - 1 },
    barCount: candles.length,
    elapsedMs: 0,
    cached: false
  };
}
async function runStrategy(compiled2, meta, diagnostics, candles, inputs, req) {
  const config = resolveStrategyConfig(compiled2, req.strategy);
  const outcome = await executeStrategy({
    compiled: compiled2,
    candles,
    inputs: inputs ?? {},
    config,
    symbol: req.symbol,
    timeframe: req.timeframe,
    source: req.script
  });
  if (outcome.error || !outcome.result) {
    throw new PineFailure(outcome.error ?? { heading: "Strategy Error", message: "The backtest produced no result." });
  }
  return {
    meta,
    diagnostics,
    outputs: outcome.outputs ? serializeOutputs(outcome.outputs) : serializeOutputs(emptyOutputs()),
    drawings: [...outcome.drawings],
    strategy: outcome.result,
    strategyConfig: config,
    range: rangeOf(candles, outcome.candles),
    barCount: outcome.candles.length,
    elapsedMs: 0,
    cached: false
  };
}

// server/validate.ts
var MAX_SCRIPT_CHARS = 256e3;
var MAX_SYMBOL_CHARS = 32;
var MAX_TIMEFRAME_CHARS = 16;
var MAX_BARS = 2e5;
var MAX_INPUTS = 500;
var MAX_INPUT_STRING_CHARS = 4e3;
var ValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(value, field, max, trim = true) {
  if (typeof value !== "string") throw new ValidationError(`\`${field}\` must be a string.`);
  if (value.trim().length === 0) throw new ValidationError(`\`${field}\` must not be empty.`);
  if (value.length > max) throw new ValidationError(`\`${field}\` exceeds ${max} characters.`);
  return trim ? value.trim() : value;
}
function optionalInt(value, field, min, max) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`\`${field}\` must be an integer between ${min} and ${max}.`);
  }
  return value;
}
function validateInputs(value) {
  if (value === void 0 || value === null) return void 0;
  if (!isRecord(value)) throw new ValidationError("`inputs` must be an object.");
  const entries = Object.entries(value);
  if (entries.length > MAX_INPUTS) throw new ValidationError(`\`inputs\` may not hold more than ${MAX_INPUTS} keys.`);
  const out = {};
  for (const [key, raw] of entries) {
    if (typeof raw === "string") {
      if (raw.length > MAX_INPUT_STRING_CHARS) throw new ValidationError(`Input \`${key}\` is too long.`);
    } else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) throw new ValidationError(`Input \`${key}\` must be a finite number.`);
    } else if (typeof raw !== "boolean") {
      throw new ValidationError(`Input \`${key}\` must be a number, boolean or string.`);
    }
    out[key] = raw;
  }
  return out;
}
var NUMERIC_CONFIG = {
  initialCapital: { min: 0, max: 1e12 },
  qtyValue: { min: 0, max: 1e12 },
  commissionValue: { min: 0, max: 1e9 },
  slippage: { min: 0, max: 1e6 },
  mintick: { min: 1e-12, max: 1e6 },
  pyramiding: { min: 0, max: 1e3, integer: true },
  marginLong: { min: 0, max: 100 },
  marginShort: { min: 0, max: 100 }
};
var QTY_TYPES = /* @__PURE__ */ new Set(["fixed", "cash", "percent_of_equity"]);
var COMMISSION_TYPES = /* @__PURE__ */ new Set(["percent", "cash_per_contract", "cash_per_order"]);
var TIME_BOUNDS = { min: 0, max: 4102444800 };
function validateStrategy(value) {
  if (value === void 0 || value === null) return void 0;
  if (!isRecord(value)) throw new ValidationError("`strategy` must be an object.");
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === void 0) continue;
    const numeric = NUMERIC_CONFIG[key];
    if (numeric) {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < numeric.min || raw > numeric.max) {
        throw new ValidationError(`\`strategy.${key}\` must be a number between ${numeric.min} and ${numeric.max}.`);
      }
      if (numeric.integer && !Number.isInteger(raw)) {
        throw new ValidationError(`\`strategy.${key}\` must be an integer.`);
      }
      out[key] = raw;
      continue;
    }
    if (key === "qtyType" || key === "commissionType") {
      const allowed = key === "qtyType" ? QTY_TYPES : COMMISSION_TYPES;
      if (typeof raw !== "string" || !allowed.has(raw)) {
        throw new ValidationError(`\`strategy.${key}\` must be one of: ${[...allowed].join(", ")}.`);
      }
      out[key] = raw;
      continue;
    }
    if (key === "processOrdersOnClose") {
      if (typeof raw !== "boolean") throw new ValidationError("`strategy.processOrdersOnClose` must be a boolean.");
      out[key] = raw;
      continue;
    }
    if (key === "from" || key === "to") {
      if (raw === null) {
        out[key] = null;
        continue;
      }
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < TIME_BOUNDS.min || raw > TIME_BOUNDS.max) {
        throw new ValidationError(`\`strategy.${key}\` must be null or an epoch-seconds integer.`);
      }
      out[key] = raw;
      continue;
    }
  }
  if (typeof out.from === "number" && typeof out.to === "number" && out.from > out.to) {
    throw new ValidationError("`strategy.from` must not be later than `strategy.to`.");
  }
  return out;
}
function validateExecuteRequest(body) {
  if (!isRecord(body)) throw new ValidationError("Request body must be a JSON object.");
  const request = {
    script: requireString(body.script, "script", MAX_SCRIPT_CHARS, false),
    symbol: requireString(body.symbol, "symbol", MAX_SYMBOL_CHARS),
    timeframe: requireString(body.timeframe, "timeframe", MAX_TIMEFRAME_CHARS)
  };
  const inputs = validateInputs(body.inputs);
  if (inputs) request.inputs = inputs;
  const bars = optionalInt(body.bars, "bars", 1, MAX_BARS);
  if (bars !== void 0) request.bars = bars;
  const strategy = validateStrategy(body.strategy);
  if (strategy) request.strategy = strategy;
  return request;
}

// server/app.ts
var MAX_BODY_BYTES = 1e6;
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}
function sendError(res, status, heading, message, line, col) {
  sendJson(res, status, { error: { heading, message, ...line !== void 0 ? { line } : {}, ...col !== void 0 ? { col } : {} } });
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError("Request body is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new ValidationError("Request body is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("Request body is not valid JSON.");
  }
}
async function handleCandles(url, res) {
  const symbol = url.searchParams.get("symbol");
  if (!symbol) throw new ValidationError("Query parameter `symbol` is required.");
  const barsParam = url.searchParams.get("bars");
  const bars = barsParam === null ? void 0 : Number(barsParam);
  if (bars !== void 0 && (!Number.isInteger(bars) || bars < 1)) {
    throw new ValidationError("Query parameter `bars` must be a positive integer.");
  }
  const candles = recentBars(await loadSymbol(symbol), bars);
  const payload = {
    symbol: symbol.toUpperCase(),
    timeframe: url.searchParams.get("timeframe") ?? "D",
    candles: [...candles]
  };
  sendJson(res, 200, payload);
}
async function handleExecute(req, res) {
  const request = validateExecuteRequest(await readJsonBody(req));
  sendJson(res, 200, await executePine(request));
}
async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/candles") return handleCandles(url, res);
  if (req.method === "POST" && url.pathname === "/api/pine/execute") return handleExecute(req, res);
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });
  if (url.pathname === "/api/candles" || url.pathname === "/api/pine/execute") {
    sendError(res, 405, "Method Not Allowed", `${req.method} is not supported on ${url.pathname}.`);
    return;
  }
  sendError(res, 404, "Not Found", `No route for ${url.pathname}.`);
}
function handleRequest(req, res) {
  return route(req, res).catch((err) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof ValidationError) {
      sendError(res, 400, "Invalid Request", err.message);
      return;
    }
    if (err instanceof DatasetError) {
      sendError(res, err.status, "Data Error", err.message);
      return;
    }
    if (err instanceof PineFailure) {
      sendError(res, err.status, err.pine.heading, err.pine.message, err.pine.line, err.pine.col);
      return;
    }
    console.error("[pine] unhandled error", err);
    sendError(res, 500, "Server Error", "The execution service failed to handle the request.");
  });
}

// server/vercel-handler.ts
function handler(req, res) {
  return handleRequest(req, res);
}
export {
  handler as default
};
