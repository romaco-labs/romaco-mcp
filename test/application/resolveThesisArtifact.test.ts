import { describe, expect, it } from 'vitest';
import { InMemoryAnalysisRepository } from '../../src/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { ResolveThesisArtifactUseCase } from '../../src/application/use-cases/resolveThesisArtifact.js';
import { analyzeSession } from '../../src/compression/analyze.js';
import { uptrendCandles } from '../compression/fixtures.js';
import { SerializedActiveSessionActivation } from '../../src/application/use-cases/serializedActiveSessionActivation.js';

const candles = uptrendCandles(220, 100, 0.6);

function fixture() {
  let datasetNumber = 0;
  let analysisNumber = 0;
  const datasets = new InMemoryDatasetRepository(() => String(++datasetNumber));
  const analyses = new InMemoryAnalysisRepository(() => String(++analysisNumber));
  const source = {
    read: () => ({
      source: 'raw' as const,
      symbol: 'AAPL',
      timeframe: '1d' as const,
      candles,
      fetchedAt: 1,
    }),
  };
  const activation = new SerializedActiveSessionActivation(datasets, analyses, { replace: () => {} });
  return {
    datasets,
    analyses,
    useCase: new ResolveThesisArtifactUseCase(datasets, analyses, source, activation, () => 123),
  };
}

describe('ResolveThesisArtifactUseCase', () => {
  it('stores local analysis once and returns stable analysisId', async () => {
    const { useCase, analyses } = fixture();

    const first = await useCase.resolve();
    const second = await useCase.resolve();

    expect(first.analysisId).toBe('analysis_1');
    expect(second).toBe(first);
    expect(first.provider).toBe('local');
    expect(await analyses.getActive()).toBe(first);
  });

  it('stores a validated gateway thesis with the same local summary', async () => {
    const { useCase } = fixture();
    const gatewayThesis = {
      ...analyzeSession(candles).thesis,
      notes: ['validated gateway artifact'],
    };

    const artifact = await useCase.storeGatewayThesis(gatewayThesis);
    const repeated = await useCase.storeGatewayThesis(gatewayThesis);

    expect(artifact.provider).toBe('gateway');
    expect(artifact.thesis).toEqual(gatewayThesis);
    expect(repeated).toBe(artifact);
    expect(await useCase.resolve(artifact.analysisId)).toBe(artifact);
  });

  it('rejects malformed gateway direction before persistence', async () => {
    const { useCase, analyses } = fixture();
    const thesis = analyzeSession(candles).thesis;
    expect(thesis.setup).not.toBeNull();

    await expect(useCase.storeGatewayThesis({
      ...thesis,
      verdict: 'long',
      setup: { ...thesis.setup!, stop: thesis.setup!.entry + 1 },
    })).rejects.toThrow(/direction/i);
    expect(await analyses.getActive()).toBeNull();
  });

  it('resolves explicit analysisId independently without mutating active state', async () => {
    const { useCase, datasets, analyses } = fixture();
    const artifact = await useCase.resolve();
    const other = await datasets.save({
      source: 'raw', symbol: 'MSFT', timeframe: '1d', candles, fetchedAt: 2,
    });
    await datasets.setActive(other.datasetId);
    await analyses.clearActive();

    await expect(useCase.resolve(artifact.analysisId)).resolves.toBe(artifact);
    await expect(datasets.getActive()).resolves.toBe(other);
    await expect(analyses.getActive()).resolves.toBeNull();
  });
});
