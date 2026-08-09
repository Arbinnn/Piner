import { useMemo, useRef } from 'react';
import csvUrl from './assets/ADBL.csv?url';
import { useCandles } from './hooks/useCandles';
import { useChart } from './hooks/useChart';
import { usePineScript } from './hooks/usePineScript';
import { toPinerBars } from './lib/csvLoader';
import { Toolbar } from './components/Toolbar';
import { PineEditor } from './components/PineEditor';
import { Chart } from './components/Chart';
import { InputsPanel } from './components/InputsPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { Splitter } from './components/Splitter';
import './App.css';

function App(): React.JSX.Element {
  const { candles, loading, error } = useCandles(csvUrl);
  const bars = useMemo(() => toPinerBars(candles), [candles]);
  const { containerRef, rendererRef } = useChart(candles);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const { source, setSource, run, isRunning, inputs, setInputValue, resetInputs, entries, title } = usePineScript({
    candles,
    bars,
    ready: !loading && candles.length > 0,
    rendererRef,
  });

  return (
    <div className="app">
      <Toolbar title={title} isRunning={isRunning} canRun={!loading && candles.length > 0} onRun={run} />

      <div className="workspace" ref={workspaceRef}>
        <div className="workspace__left">
          <PineEditor value={source} onChange={setSource} onRun={run} />
          <InputsPanel inputs={inputs} onChange={setInputValue} onReset={resetInputs} />
        </div>

        <Splitter targetRef={workspaceRef} />

        <div className="workspace__right">
          {error && <div className="data-error">Failed to load ADBL.csv: {error}</div>}
          <Chart containerRef={containerRef} />
        </div>
      </div>

      <ConsolePanel entries={entries} />
    </div>
  );
}

export default App;
