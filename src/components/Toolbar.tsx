import { memo } from 'react';
import type { PineScriptType } from '../strategy/types';
import type { Theme } from '../hooks/useTheme';

interface ToolbarProps {
  title: string;
  isRunning: boolean;
  canRun: boolean;
  onRun: () => void;
  scriptType: PineScriptType;
  theme: Theme;
  onToggleTheme: () => void;
}

function SunIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.3A8.3 8.3 0 1 1 9.7 4a6.7 6.7 0 0 0 10.3 10.3Z" />
    </svg>
  );
}

function ToolbarImpl({
  title,
  isRunning,
  canRun,
  onRun,
  scriptType,
  theme,
  onToggleTheme,
}: ToolbarProps): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">
          Piner
          <span className="toolbar__logo-cursor" aria-hidden="true" />
        </span>
        {title && <span className="toolbar__title">{title}</span>}
        {scriptType !== 'unknown' && <span className={`mode-badge mode-badge--${scriptType}`}>{scriptType}</span>}
      </div>
      <div className="toolbar__actions">
        <span className={`toolbar__status${isRunning ? ' toolbar__status--running' : ''}`}>
          <span className="toolbar__status-dot" aria-hidden="true" />
          {isRunning ? 'Running…' : 'Ready'}
        </span>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button type="button" className="btn btn--primary" onClick={onRun} disabled={!canRun}>
          Run
        </button>
      </div>
    </header>
  );
}

export const Toolbar = memo(ToolbarImpl);
