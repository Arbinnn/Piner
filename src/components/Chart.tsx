import { memo, type RefObject } from 'react';

interface ChartProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

function ChartImpl({ containerRef }: ChartProps): React.JSX.Element {
  return <div className="chart-container" ref={containerRef} />;
}

export const Chart = memo(ChartImpl);
