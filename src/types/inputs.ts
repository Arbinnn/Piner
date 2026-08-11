import type { InputDecl } from '@heyphat/piner';

/** Widened to piner's full kind union so future input kinds need no type change. */
export type InputKind = InputDecl['kind'];

export type InputValue = number | boolean | string;

export interface IndicatorInput {
  /** piner override key: the Pine title, else `input_<n>`. */
  id: string;
  title: string;
  kind: InputKind;
  value: InputValue;
  defaultValue: InputValue;
  /**
   * False when piner reported no default (`input.source(close, …)` arrives as `default: null`).
   * Such an input must not be sent as an override until the user picks a value, or the engine
   * receives our invented placeholder instead of the script's own default.
   */
  hasDefault: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: (string | number)[];
  /** Normalized: 'General' when the Pine script gave no `group`. */
  group: string;
  tooltip?: string;
}

export type InputValues = Record<string, InputValue>;
