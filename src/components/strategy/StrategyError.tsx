import { memo } from 'react';
import type { StrategyError as StrategyErrorModel } from '../../strategy/types';

interface StrategyErrorProps {
  error: StrategyErrorModel;
  onJumpToLine?: (line: number) => void;
}

/** Compile/runtime/configuration failures, shown in place of the dashboard — never thrown. */
function StrategyErrorImpl({ error, onJumpToLine }: StrategyErrorProps): React.JSX.Element {
  return (
    <div className="strategy-error" role="alert">
      <h4>{error.heading}</h4>
      {error.line !== undefined && (
        <p className="strategy-error__location">
          Line {error.line}
          {error.col !== undefined ? `, col ${error.col}` : ''}
        </p>
      )}
      <pre className="strategy-error__message">{error.message}</pre>
      {error.line !== undefined && onJumpToLine && (
        <button type="button" className="btn btn--ghost" onClick={() => onJumpToLine(error.line!)}>
          Jump to line
        </button>
      )}
    </div>
  );
}

export const StrategyError = memo(StrategyErrorImpl);
