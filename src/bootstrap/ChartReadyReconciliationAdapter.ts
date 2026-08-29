import type {
  ReconcileChartStateResult,
  ReconcileChartStateUseCase,
} from '../application/use-cases/reconcileChartState.js';

export interface ChartReadySource {
  setOnReady(callback: () => void): void;
}

export type ReconciliationLog = (message: string) => void;

/** Inbound adapter: transport ready event -> application reconciliation. */
export class ChartReadyReconciliationAdapter {
  constructor(
    private readonly reconcile: Pick<ReconcileChartStateUseCase, 'execute'>,
    private readonly log: ReconciliationLog = (message) => console.error(message),
  ) {}

  attach(source: ChartReadySource): void {
    source.setOnReady(() => {
      void this.handleReady();
    });
  }

  async handleReady(): Promise<ReconcileChartStateResult> {
    try {
      const result = await this.reconcile.execute();
      if (result.status === 'not-ready') {
        this.log(`[romaco-mcp] reconcile: chart not ready: ${result.notReadyReason ?? 'unknown reason'}`);
      }
      for (const failure of result.failures) {
        this.log(`[romaco-mcp] reconcile: failed ${failure.action}: ${failure.message}`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`[romaco-mcp] reconcile: unexpected failure: ${message}`);
      return {
        status: 'not-ready',
        applied: 0,
        skippedIdentity: 0,
        failures: [],
        notReadyReason: message,
      };
    }
  }
}
