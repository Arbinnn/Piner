import type { ITimeScaleApi, Logical, Time } from 'lightweight-charts';

/**
 * Converts a possibly-fractional logical (bar) index to an x pixel.
 *
 * `ITimeScaleApi.logicalToCoordinate` only honours whole indices — hand it 1000.5 and it
 * returns 0, not a point half a bar along. Anything positioned between bars (background band
 * edges, a Pine time that falls mid-bar, a drawing extended past the last candle) therefore
 * has to be interpolated from the integer index plus the current bar spacing.
 */
export function logicalToX(timeScale: ITimeScaleApi<Time>, logical: number): number {
  if (!Number.isFinite(logical)) return Number.NaN;

  const whole = Math.floor(logical);
  const base = timeScale.logicalToCoordinate(whole as Logical);
  if (base === null) return Number.NaN;

  const fraction = logical - whole;
  if (fraction === 0) return base;
  return base + fraction * timeScale.options().barSpacing;
}
