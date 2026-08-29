import type { ChartPort, ChartCommandOptions, ChartContextOptions } from '../../../application/ports/chart.js';
import type {
  ChartCommand,
  ChartCommandResult,
  ChartContext,
  ChartIdentity,
  ChartSnapshot,
  ReplaceDrawingGroupCommand,
} from '../../../domain/chart/model.js';
import { mapChartContext, mapChartIdentity } from './mapChartContext.js';

export interface BridgeTransport {
  readonly isConnected: boolean;
  readonly chartId: string | null;
  getContext(includeCandles?: boolean): Promise<unknown>;
  executeAction(action: unknown): Promise<unknown>;
  captureSnapshot(format?: 'png' | 'jpeg'): Promise<string>;
}

interface ActionResultLike {
  success: boolean;
  error?: string;
  data?: unknown;
}

export class ChartActionRejectedError extends Error {
  constructor(
    message: string,
    readonly result: ActionResultLike,
  ) {
    super(message);
    this.name = 'ChartActionRejectedError';
  }
}

function parseActionResult(value: unknown): ActionResultLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid chart ActionResult payload.');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.success !== 'boolean') throw new Error('Invalid chart ActionResult.success.');
  if (result.error !== undefined && typeof result.error !== 'string') {
    throw new Error('Invalid chart ActionResult.error.');
  }
  return { success: result.success, error: result.error as string | undefined, data: result.data };
}

function extractResourceIds(result: ActionResultLike): string[] {
  const data = result.data as Record<string, unknown> | undefined;
  if (!data) return [];
  const ids: string[] = [];
  if (typeof data.indicatorId === 'string') ids.push(data.indicatorId);
  if (typeof data.drawingId === 'string') ids.push(data.drawingId);
  const alert = data.alert as Record<string, unknown> | undefined;
  if (typeof alert?.id === 'string') ids.push(alert.id);
  if (Array.isArray(data.drawingIds)) {
    ids.push(...data.drawingIds.filter((id): id is string => typeof id === 'string'));
  }
  return ids;
}

function requireSuccess(value: unknown): ChartCommandResult {
  const result = parseActionResult(value);
  if (!result.success) {
    throw new ChartActionRejectedError(result.error ?? 'Chart action failed.', result);
  }
  return { ...result, resourceIds: extractResourceIds(result) };
}

function assertIdentity(expected: ChartIdentity | undefined, actual: ChartIdentity): void {
  if (!expected) return;
  if (expected.chartId !== actual.chartId) {
    throw new Error(`Chart identity mismatch: expected ${expected.chartId}, got ${actual.chartId}.`);
  }
  if (expected.symbol !== undefined && expected.symbol !== actual.symbol) {
    throw new Error(`Chart symbol mismatch: expected ${expected.symbol}, got ${actual.symbol ?? 'unknown'}.`);
  }
  if (expected.timeframe !== undefined && expected.timeframe !== actual.timeframe) {
    throw new Error(
      `Chart timeframe mismatch: expected ${expected.timeframe}, got ${actual.timeframe ?? 'unknown'}.`,
    );
  }
}

function toAgentDrawingInput(drawing: ReplaceDrawingGroupCommand['drawings'][number]) {
  return {
    drawingType: drawing.drawingType,
    points: drawing.points,
    label: drawing.label,
    style: drawing.style,
    paneId: drawing.paneId,
  };
}

export class BridgeChartAdapter implements ChartPort {
  constructor(private readonly transport: BridgeTransport) {}

  isConnected(): boolean {
    return this.transport.isConnected;
  }

  async getIdentity(): Promise<ChartIdentity> {
    const chartId = this.requireChartId();
    return mapChartIdentity(chartId, await this.transport.getContext(false));
  }

  async getContext(options: ChartContextOptions = {}): Promise<ChartContext> {
    const chartId = this.requireChartId();
    const raw = await this.transport.getContext(options.includeCandles ?? true);
    return mapChartContext(chartId, raw);
  }

  async execute(
    command: ChartCommand,
    options: ChartCommandOptions = {},
  ): Promise<ChartCommandResult> {
    if (options.expectedIdentity) {
      assertIdentity(options.expectedIdentity, await this.getIdentity());
    }
    return requireSuccess(await this.transport.executeAction(command));
  }

  async replaceDrawingGroup(command: ReplaceDrawingGroupCommand): Promise<ChartCommandResult> {
    assertIdentity(command.expectedIdentity, await this.getIdentity());
    return requireSuccess(await this.transport.executeAction({
      action: 'replaceAgentDrawingGroup',
      groupId: command.groupId,
      idempotencyKey: command.idempotencyKey,
      drawings: command.drawings.map(toAgentDrawingInput),
    }));
  }

  async captureSnapshot(format: 'png' | 'jpeg'): Promise<ChartSnapshot> {
    return { format, dataUrl: await this.transport.captureSnapshot(format) };
  }

  private requireChartId(): string {
    const chartId = this.transport.chartId;
    if (!chartId) throw new Error('No chart identity announced. Wait for McpBridge ready.');
    return chartId;
  }
}
