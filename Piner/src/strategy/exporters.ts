/** Browser-side export of a finished backtest. No dependency, no server round-trip. */

import type { StrategyConfig, StrategyExecutionResult } from './types';

const TRADE_COLUMNS = [
  'trade_id',
  'direction',
  'entry_time',
  'entry_price',
  'exit_time',
  'exit_price',
  'quantity',
  'gross_pnl',
  'commission',
  'net_pnl',
  'return_percent',
  'duration_ms',
] as const;

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function tradesToCsv(result: StrategyExecutionResult): string {
  const rows = [TRADE_COLUMNS.join(',')];
  for (const trade of result.trades) {
    rows.push(
      [
        trade.index,
        trade.direction,
        isoOf(trade.entryTime),
        trade.entryPrice,
        isoOf(trade.exitTime),
        trade.exitPrice,
        trade.quantity,
        trade.grossPnL,
        trade.commission,
        trade.netPnL,
        trade.returnPercent,
        trade.durationMs,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\n');
}

export function summaryToJson(result: StrategyExecutionResult, config: StrategyConfig): string {
  return JSON.stringify(
    {
      strategy: result.title,
      dataset: { symbol: result.symbol, timeframe: result.timeframe, bars: result.barCount },
      period: { from: isoOf(result.firstBarTime), to: isoOf(result.lastBarTime) },
      settings: config,
      metrics: result.summary,
      openPosition: result.openPosition,
      trades: result.trades,
      equityCurve: result.equityCurve,
    },
    null,
    2,
  );
}

function download(filename: string, mime: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'strategy';
}

export function exportTradesCsv(result: StrategyExecutionResult): void {
  download(`${slug(result.title)}-trades.csv`, 'text/csv;charset=utf-8', tradesToCsv(result));
}

export function exportSummaryJson(result: StrategyExecutionResult, config: StrategyConfig): void {
  download(`${slug(result.title)}-backtest.json`, 'application/json', summaryToJson(result, config));
}
