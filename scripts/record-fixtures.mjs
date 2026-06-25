#!/usr/bin/env node
/**
 * Records real-market candle fixtures for the golden parity tests.
 *
 * Usage:  npm run build && node scripts/record-fixtures.mjs
 *
 * Fetches daily candles through the same loader the MCP server uses and
 * freezes them as JSON under test/fixtures/real/. Tests never touch the
 * network — these files ARE the market, as of the recording date.
 *
 * Re-recording moves the goldens (pattern output changes with the data);
 * only do it deliberately, alongside regenerating __golden__ snapshots.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCandles } from '../dist/data/loader.js';

const SYMBOLS = ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM'];
const TIMEFRAME = '1d';
const LOOKBACK = 400;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'real');
await mkdir(outDir, { recursive: true });

for (const symbol of SYMBOLS) {
  const { candles } = await loadCandles({ source: 'yfinance', symbol, timeframe: TIMEFRAME, lookback: LOOKBACK });
  const file = join(outDir, `${symbol}_${TIMEFRAME}_${LOOKBACK}.json`);
  await writeFile(file, JSON.stringify(candles));
  console.log(`${symbol}: ${candles.length} candles → ${file}`);
}
