import type { AnalysisRecord } from '../../domain/analysis/model.js';
import type { DatasetRecord } from '../../domain/dataset/model.js';
import type { ActiveDatasetProjection } from '../ports/activeDatasetProjection.js';
import type { ActiveSessionActivationPort } from '../ports/activeSessionActivation.js';
import type { AnalysisRepository } from '../ports/analysisRepository.js';
import type { DatasetRepository } from '../ports/datasetRepository.js';

/**
 * One FIFO commit lane for dataset + analysis + legacy projection activation.
 * Failed commits never poison later queued activations.
 */
export class SerializedActiveSessionActivation implements ActiveSessionActivationPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly datasets: DatasetRepository,
    private readonly analyses: AnalysisRepository,
    private readonly projection: ActiveDatasetProjection,
  ) {}

  activateDataset(dataset: DatasetRecord): Promise<void> {
    return this.serialize(async () => {
      await this.datasets.setActive(dataset.datasetId);
      await this.analyses.clearActive();
      this.projection.replace(dataset);
    });
  }

  activateAnalysis(dataset: DatasetRecord, analysis: AnalysisRecord): Promise<void> {
    if (analysis.datasetId !== dataset.datasetId) {
      return Promise.reject(new Error(
        `Analysis ${analysis.analysisId} belongs to ${analysis.datasetId}, not ${dataset.datasetId}.`,
      ));
    }
    return this.serialize(async () => {
      await this.datasets.setActive(dataset.datasetId);
      await this.analyses.setActive(analysis.analysisId);
      this.projection.replace(dataset);
    });
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work, work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
