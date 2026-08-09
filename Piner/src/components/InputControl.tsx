import { memo, type ChangeEvent } from 'react';
import type { IndicatorInput, InputValue } from '../types/inputs';
import { htmlColorToPine, pineColorAlphaHex, pineColorToHtml } from '../lib/color';

interface InputControlProps {
  input: IndicatorInput;
  onChange: (value: InputValue) => void;
}

const SOURCE_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'close', label: 'Close' },
  { value: 'volume', label: 'Volume' },
] as const;

function InputControlImpl({ input, onChange }: InputControlProps): React.JSX.Element {
  const fieldId = `input-${input.id}`;
  const label = (
    <label htmlFor={fieldId} title={input.tooltip}>
      {input.title}
    </label>
  );

  switch (input.kind) {
    case 'int':
    case 'float': {
      const numeric = typeof input.value === 'number' ? input.value : Number(input.value);
      const step = input.step ?? (input.kind === 'int' ? 1 : 0.01);
      const hasRange = input.min !== undefined && input.max !== undefined;
      // piner reports no default for bare `input(hlc3, ...)`, so showing our placeholder 0 would
      // misstate the script. Leave it blank until the user actually sets a value.
      const unset = !input.hasDefault && input.value === input.defaultValue;
      const handleNumberChange = (e: ChangeEvent<HTMLInputElement>) => {
        const parsed = Number(e.target.value);
        if (Number.isFinite(parsed)) onChange(input.kind === 'int' ? Math.trunc(parsed) : parsed);
      };
      return (
        <div className="input-control">
          {label}
          <div className="input-control__row">
            {hasRange && !unset && (
              <input
                type="range"
                min={input.min}
                max={input.max}
                step={step}
                value={numeric}
                onChange={handleNumberChange}
              />
            )}
            <input
              id={fieldId}
              type="number"
              min={input.min}
              max={input.max}
              step={step}
              value={unset ? '' : numeric}
              placeholder={unset ? 'Script default' : undefined}
              onChange={handleNumberChange}
            />
          </div>
        </div>
      );
    }

    case 'bool':
      return (
        <div className="input-control input-control--checkbox">
          <label htmlFor={fieldId} title={input.tooltip}>
            <input
              id={fieldId}
              type="checkbox"
              checked={Boolean(input.value)}
              onChange={(e) => onChange(e.target.checked)}
            />
            {input.title}
          </label>
        </div>
      );

    case 'color': {
      const currentPine = typeof input.value === 'string' ? input.value : '#787b86FF';
      return (
        <div className="input-control">
          {label}
          <input
            id={fieldId}
            type="color"
            value={pineColorToHtml(currentPine)}
            onChange={(e) => onChange(htmlColorToPine(e.target.value, pineColorAlphaHex(currentPine)))}
          />
        </div>
      );
    }

    case 'source':
      return (
        <div className="input-control">
          {label}
          <select id={fieldId} value={String(input.value)} onChange={(e) => onChange(e.target.value)}>
            {/* piner does not report which series `input.source(...)` defaulted to, so until the
                user picks one the honest label is "the script's own choice", not a guess. */}
            {!input.hasDefault && <option value="">Script default</option>}
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'string':
    case 'enum':
      if (input.options && input.options.length > 0) {
        return (
          <div className="input-control">
            {label}
            <select id={fieldId} value={String(input.value)} onChange={(e) => onChange(e.target.value)}>
              {input.options.map((opt) => (
                <option key={String(opt)} value={String(opt)}>
                  {String(opt)}
                </option>
              ))}
            </select>
          </div>
        );
      }
      return (
        <div className="input-control">
          {label}
          <input id={fieldId} type="text" value={String(input.value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    default:
      // price / timeframe / symbol / session / time / text_area / future kinds: text round-trip.
      return (
        <div className="input-control">
          {label}
          <input id={fieldId} type="text" value={String(input.value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

export const InputControl = memo(InputControlImpl);
