import { memo, useCallback, useState } from 'react';
import { exportSummaryJson, exportTradesCsv } from '../../strategy/exporters';
import type { UseStrategyResult } from '../../hooks/useStrategy';
import { StrategyCapitalEfficiency } from './StrategyCapitalEfficiency';
import { StrategyCurves } from './StrategyCurves';
import { StrategyError } from './StrategyError';
import { StrategyHeader } from './StrategyHeader';
import { StrategyOverview } from './StrategyOverview';
import { StrategyPerformance } from './StrategyPerformance';
import { StrategyReturnDetails } from './StrategyReturnDetails';
import { StrategyRunupsDrawdowns } from './StrategyRunupsDrawdowns';
import { StrategySettings } from './StrategySettings';
import { StrategyTrades } from './StrategyTrades';
import { StrategyTradesAnalysis } from './StrategyTradesAnalysis';

type Tab = 'overview' | 'performance' | 'summary' | 'trades' | 'properties';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'summary', label: 'Performance Summary' },
  { id: 'trades', label: 'List of Trades' },
  { id: 'properties', label: 'Properties' },
];

interface StrategyTesterProps {
  strategy: UseStrategyResult;
  title: string;
  symbol: string;
  timeframe: string;
  datasetFrom: number | null;
  datasetTo: number | null;
  onRun: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCollapse: () => void;
}

function StrategyTesterImpl({
  strategy,
  title,
  symbol,
  timeframe,
  datasetFrom,
  datasetTo,
  onRun,
  expanded,
  onToggleExpanded,
  onCollapse,
}: StrategyTesterProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const { result, status, error } = strategy;
  const openProperties = useCallback(() => setTab('properties'), []);

  return (
    <section className="strategy-tester" aria-label="Strategy Tester">
      <StrategyHeader
        title={title}
        symbol={symbol}
        timeframe={timeframe}
        status={status}
        result={result}
        config={strategy.config}
        onConfigChange={strategy.setConfig}
        datasetFrom={datasetFrom}
        datasetTo={datasetTo}
        onRun={onRun}
        onOpenSettings={openProperties}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onCollapse={onCollapse}
      />

      <nav className="strategy-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`strategy-tabs__tab${tab === t.id ? ' strategy-tabs__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="strategy-tester__body">
        {error && <StrategyError error={error} />}

        {tab === 'properties' ? (
          <StrategySettings
            config={strategy.config}
            onChange={strategy.setConfig}
            onReset={strategy.resetConfig}
            visibility={strategy.visibility}
            onToggleVisibility={strategy.toggleVisibility}
            datasetFrom={datasetFrom}
            datasetTo={datasetTo}
            onExportJson={() => result && exportSummaryJson(result, strategy.config)}
            onExportCsv={() => result && exportTradesCsv(result)}
            canExport={result !== null}
          />
        ) : result === null ? (
          !error && (
            <p className="empty-note">
              {status === 'running' ? 'Running backtest…' : 'Run the backtest to see results.'}
            </p>
          )
        ) : tab === 'overview' ? (
          <StrategyOverview result={result} />
        ) : tab === 'performance' ? (
          // The Performance tab is the chart plus the four analysis sections, each of which
          // carries its own sub-tabs and can be folded away.
          <div className="strategy-performance-tab">
            <StrategyCurves result={result} />
            <StrategyReturnDetails result={result} />
            <StrategyTradesAnalysis result={result} />
            <StrategyRunupsDrawdowns result={result} />
            <StrategyCapitalEfficiency result={result} config={strategy.config} />
          </div>
        ) : tab === 'summary' ? (
          <StrategyPerformance result={result} />
        ) : (
          <StrategyTrades
            trades={result.trades}
            selectedTradeIndex={strategy.selectedTradeIndex}
            onSelect={strategy.selectTrade}
            onExportCsv={() => exportTradesCsv(result)}
          />
        )}
      </div>
    </section>
  );
}

export const StrategyTester = memo(StrategyTesterImpl);
