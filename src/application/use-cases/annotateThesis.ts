import type { MarketSummary, PatternHit } from '../../compression/types.js';
import type { AnalysisRecord } from '../../domain/analysis/model.js';
import type { ChartCommand, ChartIdentity } from '../../domain/chart/model.js';
import type { DatasetRecord } from '../../domain/dataset/model.js';
import type { ChartPort } from '../ports/chart.js';
import type { ChartJournalPort } from '../ports/chartJournal.js';
import type { DatasetRepository } from '../ports/datasetRepository.js';
import type { ResolveThesisArtifactUseCase } from './resolveThesisArtifact.js';

type AddDrawing = Extract<ChartCommand, { action: 'addDrawing' }>;

const GROUP = 'romaco-mcp/thesis';
const RECENT_FRACTION = 0.25;
const ZONE_ATR_FRAC = 0.25;
const FAINT = '#9598a1';
const STYLE_LEVEL: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dashed', opacity: 0.3 };
const STYLE_POC: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dotted', opacity: 0.3 };
const STYLE_PATTERN: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dotted', opacity: 0.4 };
const STYLE_ZONE: AddDrawing['style'] = {
  color: '#2962ff', lineWidth: 1, lineStyle: 'solid', opacity: 0.5, fillColor: 'rgba(41,98,255,0.12)',
};

const fmt = (number: number): string => number.toFixed(2);

function line(price: number, label: string, timestamp: number, style: AddDrawing['style']): AddDrawing {
  return {
    action: 'addDrawing', drawingType: 'horizontalLine',
    points: [{ timestamp, price }], label, style, groupId: GROUP,
  };
}

function topRecentPattern(summary: MarketSummary): PatternHit | null {
  const span = summary.meta.last_ts - summary.meta.first_ts;
  const cut = span > 0 ? summary.meta.last_ts - RECENT_FRACTION * span : Number.NEGATIVE_INFINITY;
  return summary.patterns
    .filter((pattern) => pattern.kind !== 'symmetric_triangle')
    .filter((pattern) => Math.max(...pattern.points.map((point) => point.ts), 0) >= cut)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export interface AnnotateThesisResult {
  artifact: AnalysisRecord;
  dataset: DatasetRecord;
  chartIdentity: ChartIdentity;
  groupId: string;
  drawings: readonly AddDrawing[];
  resourceIds: readonly string[];
  idempotencyKey: string;
}

export class AnnotateThesisUseCase {
  constructor(
    private readonly resolver: ResolveThesisArtifactUseCase,
    private readonly datasets: DatasetRepository,
    private readonly chart: ChartPort,
    private readonly journal: ChartJournalPort,
  ) {}

  async execute(analysisId?: string): Promise<AnnotateThesisResult> {
    const artifact = await this.resolver.resolve(analysisId);
    const dataset = await this.datasets.get(artifact.datasetId);
    if (!dataset) throw new Error(`Dataset ${artifact.datasetId} not found.`);

    const context = await this.chart.getContext({ includeCandles: true });
    const identity = context.identity;
    if (identity.symbol !== dataset.symbol || identity.timeframe !== dataset.timeframe) {
      throw new Error(
        `Chart shows ${identity.symbol ?? 'unknown'} ${identity.timeframe ?? 'unknown'} but analysis is for ${dataset.symbol} ${dataset.timeframe}.`,
      );
    }
    const candles = context.visibleCandles ?? [];
    if (candles.length === 0) throw new Error('Chart has no validated visible candles to anchor annotation.');
    const last = candles[candles.length - 1];
    const left = candles[Math.max(0, candles.length - 20)];
    const anchorTs = last.timestamp;
    const zoneLeftTs = left.timestamp;
    const visLow = Math.min(...candles.map((candle) => candle.low));
    const visHigh = Math.max(...candles.map((candle) => candle.high));

    const { summary, thesis } = artifact;
    const levels = summary.levels;
    const drawings: AddDrawing[] = [];
    for (const support of levels.support) drawings.push(line(support, `S ${fmt(support)}`, anchorTs, STYLE_LEVEL));
    for (const resistance of levels.resistance) drawings.push(line(resistance, `R ${fmt(resistance)}`, anchorTs, STYLE_LEVEL));
    if (Number.isFinite(levels.poc) && levels.poc > 0) {
      drawings.push(line(levels.poc, `POC ${fmt(levels.poc)}`, anchorTs, STYLE_POC));
    }
    const pattern = topRecentPattern(summary);
    if (pattern?.invalidation_price !== undefined && Number.isFinite(pattern.invalidation_price)) {
      drawings.push(line(pattern.invalidation_price, `${pattern.kind} invalidation`, anchorTs, STYLE_PATTERN));
    }

    const setup = thesis.setup;
    if (thesis.verdict !== 'stand_aside' && setup) {
      const atr = summary.volatility.atr;
      if (atr > 0) {
        const band = ZONE_ATR_FRAC * atr;
        const far = thesis.verdict === 'long' ? setup.entry - band : setup.entry + band;
        drawings.push({
          action: 'addDrawing', drawingType: 'rectangle',
          points: [{ timestamp: zoneLeftTs, price: setup.entry }, { timestamp: anchorTs, price: far }],
          label: 'entry zone', style: STYLE_ZONE, groupId: GROUP,
        });
      }
      drawings.push({
        action: 'addDrawing',
        drawingType: thesis.verdict === 'long' ? 'longPosition' : 'shortPosition',
        points: [
          { timestamp: zoneLeftTs, price: setup.entry },
          { timestamp: zoneLeftTs, price: setup.stop },
          { timestamp: zoneLeftTs, price: setup.target },
        ],
        label: `${thesis.verdict.toUpperCase()} · R/R ${setup.rr}`,
        groupId: GROUP,
      });
    }

    const idempotencyKey =
      `${artifact.analysisId}:${identity.chartId}:${zoneLeftTs}:${anchorTs}:thesis-v1`;
    const result = await this.chart.replaceDrawingGroup({
      groupId: GROUP,
      drawings,
      expectedIdentity: identity,
      idempotencyKey,
    });
    if (!result.success) {
      throw new Error(result.error ?? 'Chart rejected atomic thesis replacement.');
    }
    this.journal.replaceDrawingGroup(
      GROUP,
      drawings,
      identity,
      idempotencyKey,
      result.resourceIds,
    );

    if (setup && Number.isFinite(visLow) && Number.isFinite(visHigh) && visHigh > visLow) {
      const needLow = Math.min(visLow, setup.stop, setup.target);
      const needHigh = Math.max(visHigh, setup.stop, setup.target);
      if (needLow < visLow || needHigh > visHigh) {
        const pad = (needHigh - needLow) * 0.04;
        try {
          await this.chart.execute(
            { action: 'setPriceRange', min: needLow - pad, max: needHigh + pad },
            { expectedIdentity: identity },
          );
        } catch {
          // View pinning is best-effort; atomic drawing replacement already succeeded.
        }
      }
    }

    return {
      artifact,
      dataset,
      chartIdentity: identity,
      groupId: GROUP,
      drawings,
      resourceIds: result.resourceIds ?? [],
      idempotencyKey,
    };
  }
}
