import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { pineColorToRgba } from './color';
import { logicalToX } from './coords';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** One `bgcolor()` call site: a colour per bar, `null` where the bar is untinted. */
export type BackgroundLayer = readonly (string | null)[];

/**
 * Paints `bgcolor()` as full-height vertical bands.
 *
 * Scripts use this to mark regime bars — overbought/oversold stretches, signal bars — and it
 * is often the most visible thing they draw. Layers are painted in call order so a later
 * `bgcolor()` composites over an earlier one, matching Pine.
 */
export class BackgroundPrimitive implements ISeriesPrimitive<Time> {
  private layers: readonly BackgroundLayer[] = [];
  private barCount = 0;
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private readonly views: readonly IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom',
      renderer: (): IPrimitivePaneRenderer | null =>
        this.layers.length === 0 ? null : { draw: (target: RenderTarget) => this.drawBands(target) },
    },
  ];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setData(layers: readonly BackgroundLayer[], barCount: number): void {
    this.layers = layers;
    this.barCount = barCount;
    this.requestUpdate?.();
  }

  private drawBands(target: RenderTarget): void {
    const chart = this.chart;
    if (!chart || this.barCount === 0) return;

    const timeScale = chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    const from = Math.max(0, Math.floor(visible ? visible.from - 1 : 0));
    const to = Math.min(this.barCount - 1, Math.ceil(visible ? visible.to + 1 : this.barCount - 1));
    if (to < from) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const height = scope.mediaSize.height;

      // Half a bar either side, so adjacent tinted bars form one continuous band.
      const edge = (logical: number): number => logicalToX(timeScale, logical);

      for (const layer of this.layers) {
        let runStart = -1;
        let runColor = '';

        const flush = (endExclusive: number): void => {
          if (runStart < 0) return;
          const left = edge(runStart - 0.5);
          const right = edge(endExclusive - 0.5);
          if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
            ctx.fillStyle = pineColorToRgba(runColor);
            ctx.fillRect(left, 0, right - left, height);
          }
          runStart = -1;
        };

        for (let i = from; i <= to; i += 1) {
          const color = layer[i] ?? null;
          if (color === null) {
            flush(i);
            continue;
          }
          if (runStart < 0) {
            runStart = i;
            runColor = color;
          } else if (color !== runColor) {
            flush(i);
            runStart = i;
            runColor = color;
          }
        }
        flush(to + 1);
      }
    });
  }
}
