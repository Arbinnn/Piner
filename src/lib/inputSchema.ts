import type { InputDecl } from '@heyphat/piner';
import type { IndicatorInput, InputValue, InputValues } from '../types/inputs';

/** Coerces piner's `InputDecl.default` (which may be `null`) into a UI-safe value. */
function defaultValueOf(decl: InputDecl): InputValue {
  if (decl.default === null) {
    return decl.kind === 'bool' ? false : decl.kind === 'int' || decl.kind === 'float' ? 0 : '';
  }
  return decl.default;
}

/**
 * Maps piner's compile-time input schema to the UI model, normalizing `group` and
 * carrying over a previously-set value when the key+kind still match (so a Run after
 * an unrelated edit doesn't reset every control the user has touched).
 *
 * Untitled inputs get an inferred label. Scripts routinely pass `''` as the title and rely
 * on Pine's `inline` to sit them beside a labelled sibling (LuxAlgo's colour swatches do
 * exactly this); piner's schema does not carry `inline`, so the row grouping can't be
 * rebuilt — naming them after the preceding labelled input at least keeps them identifiable
 * instead of rendering a column of anonymous controls.
 */
export function toIndicatorInputs(
  decls: readonly InputDecl[],
  previous: readonly IndicatorInput[],
): IndicatorInput[] {
  const previousByKey = new Map(previous.map((p) => [p.id, p]));
  let lastTitle = '';
  let untitledRun = 0;

  return decls.map((decl) => {
    const carried = previousByKey.get(decl.key);
    const defaultValue = defaultValueOf(decl);
    const value = carried && carried.kind === decl.kind ? carried.value : defaultValue;

    const declared = (decl.title ?? '').trim();
    if (declared) {
      lastTitle = declared;
      untitledRun = 0;
    } else {
      untitledRun += 1;
    }
    const title = declared || `${lastTitle ? `${lastTitle} ` : ''}${decl.kind} ${untitledRun}`.trim();

    return {
      id: decl.key,
      title,
      kind: decl.kind,
      value,
      defaultValue,
      hasDefault: decl.default !== null,
      min: decl.minval,
      max: decl.maxval,
      step: decl.step,
      options: decl.options,
      group: decl.group ?? 'General',
      tooltip: decl.tooltip,
    };
  });
}

/**
 * Flattens the UI input model into the plain key->value map the engine expects.
 *
 * Inputs whose default piner could not report are omitted while still untouched, so the script
 * keeps its own default. Sending our placeholder instead would override e.g. `input.source(close)`
 * with an empty string, which the engine then uses as the series — turning every downstream
 * calculation into `na`.
 */
export function toInputValues(inputs: readonly IndicatorInput[]): InputValues {
  const values: InputValues = {};
  for (const input of inputs) {
    if (!input.hasDefault && input.value === input.defaultValue) continue;
    values[input.id] = input.value;
  }
  return values;
}

/** Resets every input to its compile-time default. */
export function resetToDefaults(inputs: readonly IndicatorInput[]): IndicatorInput[] {
  return inputs.map((input) => ({ ...input, value: input.defaultValue }));
}
