import { memo, useCallback, type ChangeEvent, type KeyboardEvent } from 'react';

interface PineEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

function PineEditorImpl({ value, onChange, onRun }: PineEditorProps): React.JSX.Element {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onRun();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const next = `${value.slice(0, start)}  ${value.slice(end)}`;
        onChange(next);
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [onChange, onRun, value],
  );

  return (
    <textarea
      className="pine-editor"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder="Paste Pine Script here…"
      aria-label="Pine Script editor"
    />
  );
}

export const PineEditor = memo(PineEditorImpl);
