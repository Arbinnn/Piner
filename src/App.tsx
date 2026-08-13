import { useRef, useState } from 'react';
import { useCandles } from './hooks/useCandles';
import { useChart } from './hooks/useChart';
import { usePineScript } from './hooks/usePineScript';
import { useTheme } from './hooks/useTheme';
import { Toolbar } from './components/Toolbar';
import { PineEditor } from './components/PineEditor';
import { Chart } from './components/Chart';
import { InputsPanel } from './components/InputsPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { Splitter } from './components/Splitter';
import { StrategyTester } from './components/strategy/StrategyTester';
import { StrategyChartTooltip } from './components/strategy/StrategyChartTooltip';
import './App.css';
import './strategy.css';

const SYMBOL = 'ADBL';
const TIMEFRAME = 'D';

type DockTab = 'strategy' | 'console';

function App(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const { candles, loading, error } = useCandles(SYMBOL, TIMEFRAME);
  const { containerRef, chartRef, rendererRef } = useChart(candles, theme);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  /** Which dock tab the user last picked while in strategy mode. */
  const [dockPreference, setDockPreference] = useState<DockTab>('strategy');
  /** Strategy dock height: normal, expanded to most of the window, or collapsed to its tabs. */
  const [dockSize, setDockSize] = useState<'normal' | 'expanded' | 'collapsed'>('normal');

  const { source, setSource, run, isRunning, inputs, setInputValue, resetInputs, entries, title, scriptType, strategy } =
    usePineScript({
      candles,
      symbol: SYMBOL,
      timeframe: TIMEFRAME,
      ready: !loading && candles.length > 0,
      rendererRef,
      chartRef,
    });

  const isStrategy = scriptType === 'strategy';
  // Detecting a strategy opens the Strategy Tester; an indicator always gets the plain console,
  // so indicator mode looks exactly as it did before. Derived, so no effect has to chase it.
  const dockTab: DockTab = isStrategy ? dockPreference : 'console';

  return (
    <div className="app">
      <Toolbar
        title={title}
        isRunning={isRunning}
        canRun={!loading && candles.length > 0}
        onRun={run}
        scriptType={scriptType}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="workspace" ref={workspaceRef}>
        <div className="workspace__left">
          <PineEditor value={source} onChange={setSource} onRun={run} />
          <InputsPanel inputs={inputs} onChange={setInputValue} onReset={resetInputs} />
        </div>

        <Splitter targetRef={workspaceRef} />

        <div className="workspace__right">
          {error && <div className="data-error">Failed to load {SYMBOL} data: {error}</div>}
          <Chart containerRef={containerRef} />
          <StrategyChartTooltip chartRef={chartRef} markersByTime={strategy.markersByTime} />
        </div>
      </div>

      <div className={`dock${dockTab === 'strategy' ? ` dock--${dockSize}` : ''}`}>
        {isStrategy && (
          <nav className="dock__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={dockTab === 'strategy'}
              className={`dock__tab${dockTab === 'strategy' ? ' dock__tab--active' : ''}`}
              onClick={() => setDockPreference('strategy')}
            >
              Strategy Tester
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dockTab === 'console'}
              className={`dock__tab${dockTab === 'console' ? ' dock__tab--active' : ''}`}
              onClick={() => setDockPreference('console')}
            >
              Console
            </button>
          </nav>
        )}

        {dockTab === 'strategy' && isStrategy ? (
          <StrategyTester
            strategy={strategy}
            title={title}
            symbol={SYMBOL}
            timeframe={TIMEFRAME}
            datasetFrom={candles.length > 0 ? candles[0].time : null}
            datasetTo={candles.length > 0 ? candles[candles.length - 1].time : null}
            onRun={run}
            expanded={dockSize === 'expanded'}
            onToggleExpanded={() => setDockSize((prev) => (prev === 'expanded' ? 'normal' : 'expanded'))}
            onCollapse={() => setDockSize((prev) => (prev === 'collapsed' ? 'normal' : 'collapsed'))}
          />
        ) : (
          <ConsolePanel entries={entries} />
        )}
      </div>
    </div>
  );
}

export default App;
