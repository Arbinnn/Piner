import { memo } from 'react';

interface ToolbarProps {
  title: string;
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
}

function ToolbarImpl({ title, isRunning, canRun, onRun }: ToolbarProps): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">Piner</span>
        {title && <span className="toolbar__title">{title}</span>}
      </div>
      <div className="toolbar__actions">
        <span className="toolbar__status">{isRunning ? 'Running…' : 'Ready'}</span>
        <button type="button" className="btn btn--primary" onClick={onRun} disabled={!canRun}>
          Run
        </button>
      </div>
    </header>
  );
}

export const Toolbar = memo(ToolbarImpl);
