import type { LoadResponse } from './data/types.js';

/**
 * In-memory session state for the MCP server process.
 * Holds the last-loaded candle data so subsequent analysis tools
 * don't have to re-fetch.
 *
 * Single-tenant: one user per MCP process (which is the model
 * for stdio MCP servers).
 */
class SessionState {
  private lastLoad: LoadResponse | null = null;

  setLastLoad(load: LoadResponse): void {
    this.lastLoad = load;
  }

  getLastLoad(): LoadResponse | null {
    return this.lastLoad;
  }

  clear(): void {
    this.lastLoad = null;
  }

  /** Convenience: return candles from last load, or throw with helpful message. */
  requireCandles(): LoadResponse['candles'] {
    if (!this.lastLoad) {
      throw new Error(
        'No candle data loaded. Call romaco_load_candles first with source, symbol, and timeframe.'
      );
    }
    return this.lastLoad.candles;
  }
}

export const session = new SessionState();
