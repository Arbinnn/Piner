/**
 * Display formatting for the Strategy Tester.
 *
 * Single rule everywhere: a value that could not be computed is `null` and renders `N/A`.
 * NaN/Infinity/undefined never reach the DOM — `Infinity` only survives where it is genuinely
 * meaningful (profit factor with no losing trade), and even then it shows as `∞`.
 */

export const NA = 'N/A';

/**
 * Account currency. The bundled dataset (ADBL) is a NEPSE listing, so money is Nepalese
 * rupees; piner's broker is currency-agnostic and simply works in account units.
 * Rendered as a trailing unit, TradingView-style, rather than a prefixed symbol.
 */
export const CURRENCY = 'NPR';

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (!usable(value)) return NA;
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Money. `unit: true` appends the account currency — used on cards and headline figures;
 * columns of a table stay bare so the numbers line up (the header carries the unit).
 */
export function formatMoney(value: number | null | undefined, { signed = false, unit = false } = {}): string {
  if (!usable(value)) return NA;
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  const sign = signed && value > 0 ? '+' : value < 0 ? '-' : '';
  const body = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${body}${unit ? ` ${CURRENCY}` : ''}`;
}

/** Compact money for chart axes and dense labels: 1.97K, 12.4M. */
export function formatCompactMoney(value: number | null | undefined): string {
  if (!usable(value) || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined, { signed = false, digits = 2 } = {}): string {
  if (!usable(value)) return NA;
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** Compact price with enough precision for penny instruments. */
export function formatPrice(value: number | null | undefined): string {
  if (!usable(value) || !Number.isFinite(value)) return NA;
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 5;
  return value.toFixed(digits);
}

export function formatQuantity(value: number | null | undefined): string {
  if (!usable(value) || !Number.isFinite(value)) return NA;
  return Number.isInteger(value) ? value.toString() : value.toFixed(4).replace(/0+$/, '');
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `2d 4h`, `3h 15m`, `45m` — coarse on purpose; the trade table is scanned, not read. */
export function formatDuration(ms: number | null | undefined): string {
  if (!usable(ms) || !Number.isFinite(ms) || ms < 0) return NA;
  if (ms < MINUTE) return '<1m';

  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Bar times are UTC epoch seconds (the CSV's own clock) — render them in UTC, not local. */
export function formatDateTime(seconds: number | null | undefined, { withTime = true } = {}): string {
  if (!usable(seconds) || !Number.isFinite(seconds)) return NA;
  const d = new Date(seconds * 1000);
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)}` : date;
}

/** CSS class picker for positive/negative values, using the app's theme tokens. */
export function toneOf(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (!usable(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}
