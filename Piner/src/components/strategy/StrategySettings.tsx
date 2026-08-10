import { memo } from 'react';
import type { CommissionType, QtyType, StrategyConfig, StrategyVisibility } from '../../strategy/types';
import { DownloadIcon } from './Icons';

interface StrategySettingsProps {
  config: StrategyConfig;
  onChange: (patch: Partial<StrategyConfig>) => void;
  onReset: () => void;
  visibility: StrategyVisibility;
  onToggleVisibility: (key: keyof StrategyVisibility) => void;
  datasetFrom: number | null;
  datasetTo: number | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  canExport: boolean;
}

const QTY_TYPES: { id: QtyType; label: string }[] = [
  { id: 'fixed', label: 'Fixed contracts' },
  { id: 'cash', label: 'Cash value' },
  { id: 'percent_of_equity', label: '% of equity' },
];

const COMMISSION_TYPES: { id: CommissionType; label: string }[] = [
  { id: 'percent', label: 'Percent' },
  { id: 'cash_per_contract', label: 'Cash per contract' },
  { id: 'cash_per_order', label: 'Cash per order' },
];

const OVERLAYS: { key: keyof StrategyVisibility; label: string }[] = [
  { key: 'entries', label: 'Entries' },
  { key: 'exits', label: 'Exits' },
  { key: 'openPositions', label: 'Open Positions' },
  { key: 'plots', label: 'Strategy Plots' },
  { key: 'positionBackground', label: 'Position Background' },
];

/** epoch seconds -> the `YYYY-MM-DD` a native date input speaks (UTC, like the bar times). */
function toDateInput(seconds: number | null): string {
  return seconds === null ? '' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function fromDateInput(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Positive-number guard: an empty or garbage field must not push NaN into the engine. */
function numberOr(value: string, fallback: number, { min = -Infinity } = {}): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function StrategySettingsImpl({
  config,
  onChange,
  onReset,
  visibility,
  onToggleVisibility,
  datasetFrom,
  datasetTo,
  onExportJson,
  onExportCsv,
  canExport,
}: StrategySettingsProps): React.JSX.Element {
  const fullRange = config.from === null && config.to === null;

  return (
    <div className="strategy-settings">
      <section className="strategy-panel">
        <div className="strategy-panel__header">
          <h4>Backtest Settings</h4>
          <button type="button" className="btn btn--ghost" onClick={onReset}>
            Reset to script defaults
          </button>
        </div>

        <div className="settings-grid">
          <label className="field">
            <span>Initial Capital</span>
            <input
              type="number"
              min={1}
              step={1000}
              value={config.initialCapital}
              onChange={(e) => onChange({ initialCapital: numberOr(e.target.value, config.initialCapital, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Position Size Type</span>
            <select value={config.qtyType} onChange={(e) => onChange({ qtyType: e.target.value as QtyType })}>
              {QTY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Position Size</span>
            <input
              type="number"
              min={0}
              step={config.qtyType === 'percent_of_equity' ? 1 : 0.1}
              value={config.qtyValue}
              onChange={(e) => onChange({ qtyValue: numberOr(e.target.value, config.qtyValue, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Commission Type</span>
            <select
              value={config.commissionType}
              onChange={(e) => onChange({ commissionType: e.target.value as CommissionType })}
            >
              {COMMISSION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Commission Value</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={config.commissionValue}
              onChange={(e) => onChange({ commissionValue: numberOr(e.target.value, config.commissionValue, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Slippage (ticks)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.slippage}
              onChange={(e) => onChange({ slippage: numberOr(e.target.value, config.slippage, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Tick Size</span>
            <input
              type="number"
              min={0}
              step={0.001}
              value={config.mintick}
              onChange={(e) => onChange({ mintick: numberOr(e.target.value, config.mintick, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Pyramiding (max entries)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={config.pyramiding}
              onChange={(e) => onChange({ pyramiding: Math.max(1, Math.round(numberOr(e.target.value, config.pyramiding, { min: 1 }))) })}
            />
          </label>

          <label className="field">
            <span>Margin Long (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={config.marginLong}
              onChange={(e) => onChange({ marginLong: numberOr(e.target.value, config.marginLong, { min: 0 }) })}
            />
          </label>

          <label className="field">
            <span>Margin Short (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={config.marginShort}
              onChange={(e) => onChange({ marginShort: numberOr(e.target.value, config.marginShort, { min: 0 }) })}
            />
          </label>

          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={config.processOrdersOnClose}
              onChange={() => onChange({ processOrdersOnClose: !config.processOrdersOnClose })}
            />
            <span>Fill orders on bar close</span>
          </label>
        </div>
      </section>

      <section className="strategy-panel">
        <div className="strategy-panel__header">
          <h4>Date Range</h4>
          <button type="button" className="btn btn--ghost" onClick={() => onChange({ from: null, to: null })} disabled={fullRange}>
            Entire dataset
          </button>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={toDateInput(config.from)}
              min={toDateInput(datasetFrom)}
              max={toDateInput(datasetTo)}
              onChange={(e) => onChange({ from: fromDateInput(e.target.value, false) })}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="date"
              value={toDateInput(config.to)}
              min={toDateInput(datasetFrom)}
              max={toDateInput(datasetTo)}
              onChange={(e) => onChange({ to: fromDateInput(e.target.value, true) })}
            />
          </label>
        </div>
      </section>

      <section className="strategy-panel">
        <h4>Chart Overlays</h4>
        <div className="toggle-row">
          {OVERLAYS.map((o) => (
            <label className="field field--checkbox" key={o.key}>
              <input type="checkbox" checked={visibility[o.key]} onChange={() => onToggleVisibility(o.key)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="strategy-panel">
        <h4>Export</h4>
        <div className="toggle-row">
          <button type="button" className="btn btn--icon-text" onClick={onExportCsv} disabled={!canExport}>
            <DownloadIcon /> Trades CSV
          </button>
          <button type="button" className="btn btn--icon-text" onClick={onExportJson} disabled={!canExport}>
            <DownloadIcon /> Backtest JSON
          </button>
        </div>
      </section>
    </div>
  );
}

export const StrategySettings = memo(StrategySettingsImpl);
