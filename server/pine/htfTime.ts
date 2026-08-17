/**
 * Makes `time(timeframe)` mean what Pine says it means.
 *
 * piner's `timeFn(_tf, session, tz)` ignores its timeframe argument entirely and returns the
 * chart bar's own `time`. Nothing errors — the value is a plausible timestamp — so every
 * higher-timeframe anchor built on it silently collapses to the chart timeframe. The classic
 * shape is `ta.change(time('M'))`, which every anchored-profile script uses to detect a new
 * period: it becomes true on EVERY bar, so the period is one bar long. LuxAlgo's Liquidity
 * Sentiment Profile then draws its 500 boxes with `left == right` and the chart looks empty
 * while the run reports 500 drawings.
 *
 * The engine already buckets bars correctly for `request.security` (`bucketKey` in its dist);
 * `time()` was simply never wired to it. This mirrors that bucketing and patches the context
 * method, which covers every call form — including `time(tfVar)` with a runtime string, which
 * a source rewrite could not resolve.
 *
 * ponytail: returns the theoretical bucket start, not the first traded bar's time. They differ
 * when a period opens on a holiday (a month starting Saturday reports the 1st, TradingView
 * reports the 3rd). Every boundary test — `ta.change`, comparisons, `!=` — lands on the same
 * bar either way. Track real bar opens only if a script ever plots the value itself.
 */

const DAY_MS = 86_400_000;

/** Epoch day 0 is a Thursday; +3 puts a week boundary on Monday, as the engine's bucketing does. */
const WEEK_EPOCH_OFFSET_DAYS = 3;

/** `'240'`, `'D'`, `'3M'` -> multiplier and unit. An empty unit means minutes. */
function parseTf(tf: string): { mult: number; unit: string } {
  const m = /^(\d*)([a-zA-Z]?)$/.exec(tf);
  if (!m) return { mult: 1, unit: '' };
  return { mult: m[1] ? Number(m[1]) : 1, unit: (m[2] || '').toUpperCase() };
}

/**
 * Opening timestamp of the `tf` period containing `timeMs`. Boundaries match the engine's own
 * `bucketKey`, so `time(tf)` changes on exactly the bars `request.security(_, tf, _)` steps on.
 */
export function bucketStart(timeMs: number, tf: string): number {
  if (!Number.isFinite(timeMs)) return NaN;
  const { mult, unit } = parseTf(tf);
  if (!(mult > 0)) return timeMs;

  switch (unit) {
    case 'S':
      return Math.floor(timeMs / (mult * 1000)) * mult * 1000;
    case 'D':
      return Math.floor(timeMs / (mult * DAY_MS)) * mult * DAY_MS;
    case 'W': {
      const days = Math.floor(timeMs / DAY_MS) + WEEK_EPOCH_OFFSET_DAYS;
      return (Math.floor(days / (7 * mult)) * 7 * mult - WEEK_EPOCH_OFFSET_DAYS) * DAY_MS;
    }
    case 'M': {
      const d = new Date(timeMs);
      return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / mult) * mult, 1);
    }
    default:
      return Math.floor(timeMs / (mult * 60_000)) * mult * 60_000;
  }
}

/** The slice of a piner execution context this patch touches. */
interface TimeContext {
  time: number;
  timeFn(tf?: unknown, session?: unknown, tz?: unknown): number;
}

/**
 * Replaces `ctx.timeFn` with one that honours its timeframe argument. Calls with no timeframe,
 * or with a session string (whose in/out-of-session `na` handling is the engine's own and stays
 * correct), fall through to the original.
 */
export function patchHtfTime(ctx: TimeContext): void {
  const original = ctx.timeFn.bind(ctx);
  ctx.timeFn = function patched(tf?: unknown, session?: unknown, tz?: unknown): number {
    if (typeof session === 'string' && session !== '') return original(tf, session, tz);
    if (typeof tf !== 'string' || tf === '') return original(tf, session, tz);
    return bucketStart(ctx.time, tf);
  };
}
