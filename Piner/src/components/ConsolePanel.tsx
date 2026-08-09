import { memo, useEffect, useRef } from 'react';
import type { ConsoleEntry } from '../types/candle';

interface ConsolePanelProps {
  entries: ConsoleEntry[];
}

function ConsolePanelImpl({ entries }: ConsolePanelProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  return (
    <section className="console-panel" aria-label="Console">
      {entries.length === 0 && <div className="console-panel__empty">No output yet — click Run.</div>}
      {entries.map((entry) => (
        <div key={entry.id} className={`console-entry console-entry--${entry.level}`}>
          <span className="console-entry__heading">{entry.heading}</span>
          <span className="console-entry__message">
            {entry.line !== undefined ? `${entry.line}:${entry.col ?? 0}  ` : ''}
            {entry.message}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </section>
  );
}

export const ConsolePanel = memo(ConsolePanelImpl);
