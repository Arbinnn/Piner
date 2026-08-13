/**
 * The strategy dashboard's model and helpers.
 *
 * Execution no longer lives here: the backtest runs on the backend (`server/strategy/`) and
 * arrives as a `StrategyExecutionResult`. What remains is the shared result shape plus the
 * pure derivations both sides use — `metrics`/`strategyAdapter` are imported by the server too.
 */
export * from './types';
export { detectPineScriptType } from './strategyDetector';
export { buildEquityCurve, buildOpenPosition, buildPositions, buildTrades } from './strategyAdapter';
export type { OpenLotSnapshot } from './strategyAdapter';
export { computeSummary, equityPhases, periodPerformance } from './metrics';
export { buildStrategyMarkers, buildPositionBackground } from './markers';
export type { MarkerInfo, StrategyMarkers } from './markers';
export { exportTradesCsv, exportSummaryJson } from './exporters';
