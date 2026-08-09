import { memo, useMemo } from 'react';
import type { IndicatorInput, InputValue } from '../types/inputs';
import { InputControl } from './InputControl';

interface InputsPanelProps {
  inputs: IndicatorInput[];
  onChange: (id: string, value: InputValue) => void;
  onReset: () => void;
}

function groupInputs(inputs: readonly IndicatorInput[]): Map<string, IndicatorInput[]> {
  const groups = new Map<string, IndicatorInput[]>();
  for (const input of inputs) {
    const bucket = groups.get(input.group);
    if (bucket) bucket.push(input);
    else groups.set(input.group, [input]);
  }
  return groups;
}

function InputsPanelImpl({ inputs, onChange, onReset }: InputsPanelProps): React.JSX.Element | null {
  const groups = useMemo(() => groupInputs(inputs), [inputs]);

  if (inputs.length === 0) return null;

  return (
    <section className="inputs-panel">
      <div className="inputs-panel__header">
        <h3>Indicator Settings</h3>
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Reset
        </button>
      </div>
      {Array.from(groups.entries()).map(([group, groupInputsList]) => (
        <details key={group} className="inputs-panel__group" open>
          <summary>{group}</summary>
          <div className="inputs-panel__fields">
            {groupInputsList.map((input) => (
              <InputControl key={input.id} input={input} onChange={(value) => onChange(input.id, value)} />
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

export const InputsPanel = memo(InputsPanelImpl);
