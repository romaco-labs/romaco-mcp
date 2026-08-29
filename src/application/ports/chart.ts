import type {
  ChartCommand,
  ChartCommandResult,
  ChartContext,
  ChartIdentity,
  ChartSnapshot,
  ReplaceDrawingGroupCommand,
} from '../../domain/chart/model.js';

export interface ChartContextOptions {
  includeCandles?: boolean;
}

export interface ChartCommandOptions {
  expectedIdentity?: ChartIdentity;
  idempotencyKey?: string;
}

export interface ChartPort {
  isConnected(): boolean;
  getIdentity(): Promise<ChartIdentity>;
  getContext(options?: ChartContextOptions): Promise<ChartContext>;
  execute(command: ChartCommand, options?: ChartCommandOptions): Promise<ChartCommandResult>;
  replaceDrawingGroup(command: ReplaceDrawingGroupCommand): Promise<ChartCommandResult>;
  captureSnapshot(format: 'png' | 'jpeg'): Promise<ChartSnapshot>;
}
