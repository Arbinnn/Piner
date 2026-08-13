/**
 * Request validation — the trust boundary.
 *
 * Everything past this module is fed straight into the compiler, the engine and the broker,
 * so nothing is taken on faith: unknown keys are dropped rather than forwarded, and every
 * value is checked for type and range instead of being coerced.
 */

import type { ExecuteRequest } from '../src/types/pine.ts';
import type { InputValue, InputValues } from '../src/types/inputs.ts';
import type { StrategyConfig } from '../src/strategy/types.ts';

const MAX_SCRIPT_CHARS = 256_000;
const MAX_SYMBOL_CHARS = 32;
const MAX_TIMEFRAME_CHARS = 16;
const MAX_BARS = 200_000;
const MAX_INPUTS = 500;
const MAX_INPUT_STRING_CHARS = 4_000;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `trim: false` for the script itself — stripping a leading blank line would shift every
 * compile diagnostic one line off what the editor shows.
 */
function requireString(value: unknown, field: string, max: number, trim = true): string {
  if (typeof value !== 'string') throw new ValidationError(`\`${field}\` must be a string.`);
  if (value.trim().length === 0) throw new ValidationError(`\`${field}\` must not be empty.`);
  if (value.length > max) throw new ValidationError(`\`${field}\` exceeds ${max} characters.`);
  return trim ? value.trim() : value;
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`\`${field}\` must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** Input overrides: a flat map of Pine scalars. Nested objects and functions are rejected. */
function validateInputs(value: unknown): InputValues | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ValidationError('`inputs` must be an object.');

  const entries = Object.entries(value);
  if (entries.length > MAX_INPUTS) throw new ValidationError(`\`inputs\` may not hold more than ${MAX_INPUTS} keys.`);

  const out: InputValues = {};
  for (const [key, raw] of entries) {
    if (typeof raw === 'string') {
      if (raw.length > MAX_INPUT_STRING_CHARS) throw new ValidationError(`Input \`${key}\` is too long.`);
    } else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw new ValidationError(`Input \`${key}\` must be a finite number.`);
    } else if (typeof raw !== 'boolean') {
      throw new ValidationError(`Input \`${key}\` must be a number, boolean or string.`);
    }
    out[key] = raw as InputValue;
  }
  return out;
}

/**
 * Backtest settings the user may override, with the range each one is meaningful over.
 * An allowlist rather than a pass-through: these become broker settings, and an unchecked
 * value here is a division by zero or an unbounded loop deep inside the engine.
 */
const NUMERIC_CONFIG: Record<string, { min: number; max: number; integer?: boolean }> = {
  initialCapital: { min: 0, max: 1e12 },
  qtyValue: { min: 0, max: 1e12 },
  commissionValue: { min: 0, max: 1e9 },
  slippage: { min: 0, max: 1e6 },
  mintick: { min: 1e-12, max: 1e6 },
  pyramiding: { min: 0, max: 1000, integer: true },
  marginLong: { min: 0, max: 100 },
  marginShort: { min: 0, max: 100 },
};

const QTY_TYPES = new Set(['fixed', 'cash', 'percent_of_equity']);
const COMMISSION_TYPES = new Set(['percent', 'cash_per_contract', 'cash_per_order']);
/** Epoch seconds, wide enough for any dataset and narrow enough to catch a milliseconds mix-up. */
const TIME_BOUNDS = { min: 0, max: 4_102_444_800 };

function validateStrategy(value: unknown): Partial<StrategyConfig> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ValidationError('`strategy` must be an object.');

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;

    const numeric = NUMERIC_CONFIG[key];
    if (numeric) {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < numeric.min || raw > numeric.max) {
        throw new ValidationError(`\`strategy.${key}\` must be a number between ${numeric.min} and ${numeric.max}.`);
      }
      if (numeric.integer && !Number.isInteger(raw)) {
        throw new ValidationError(`\`strategy.${key}\` must be an integer.`);
      }
      out[key] = raw;
      continue;
    }

    if (key === 'qtyType' || key === 'commissionType') {
      const allowed = key === 'qtyType' ? QTY_TYPES : COMMISSION_TYPES;
      if (typeof raw !== 'string' || !allowed.has(raw)) {
        throw new ValidationError(`\`strategy.${key}\` must be one of: ${[...allowed].join(', ')}.`);
      }
      out[key] = raw;
      continue;
    }

    if (key === 'processOrdersOnClose') {
      if (typeof raw !== 'boolean') throw new ValidationError('`strategy.processOrdersOnClose` must be a boolean.');
      out[key] = raw;
      continue;
    }

    if (key === 'from' || key === 'to') {
      if (raw === null) {
        out[key] = null;
        continue;
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < TIME_BOUNDS.min || raw > TIME_BOUNDS.max) {
        throw new ValidationError(`\`strategy.${key}\` must be null or an epoch-seconds integer.`);
      }
      out[key] = raw;
      continue;
    }

    // Unknown key: dropped, not an error — an older client sending a retired field still runs.
  }

  if (typeof out.from === 'number' && typeof out.to === 'number' && out.from > out.to) {
    throw new ValidationError('`strategy.from` must not be later than `strategy.to`.');
  }
  return out as Partial<StrategyConfig>;
}

/** Parses and checks an `/api/pine/execute` body. Throws `ValidationError` on anything wrong. */
export function validateExecuteRequest(body: unknown): ExecuteRequest {
  if (!isRecord(body)) throw new ValidationError('Request body must be a JSON object.');

  const request: ExecuteRequest = {
    script: requireString(body.script, 'script', MAX_SCRIPT_CHARS, false),
    symbol: requireString(body.symbol, 'symbol', MAX_SYMBOL_CHARS),
    timeframe: requireString(body.timeframe, 'timeframe', MAX_TIMEFRAME_CHARS),
  };

  const inputs = validateInputs(body.inputs);
  if (inputs) request.inputs = inputs;

  const bars = optionalInt(body.bars, 'bars', 1, MAX_BARS);
  if (bars !== undefined) request.bars = bars;

  const strategy = validateStrategy(body.strategy);
  if (strategy) request.strategy = strategy;

  return request;
}
