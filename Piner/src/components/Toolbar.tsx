import { memo } from 'react';
import type { PineScriptType } from '../strategy/types';

interface ToolbarProps {
  title: string;
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
  scriptType: PineScriptType;
}

function ToolbarImpl({ title, isRunning, canRun, onRun, scriptType }: ToolbarProps): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">Piner</span>
        {title && <span className="toolbar__title">{title}</span>}
        {scriptType !== 'unknown' && <span className={`mode-badge mode-badge--${scriptType}`}>{scriptType}</span>}
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
