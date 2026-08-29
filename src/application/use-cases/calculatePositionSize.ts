import {
  calculatePositionSize,
  type CalculatePositionSizeInput,
  type PositionSizeResult,
} from '../../domain/risk/calculatePositionSize.js';

export type { CalculatePositionSizeInput, PositionSizeResult };

export class CalculatePositionSizeUseCase {
  execute(input: CalculatePositionSizeInput): PositionSizeResult {
    return calculatePositionSize(input);
  }
}
