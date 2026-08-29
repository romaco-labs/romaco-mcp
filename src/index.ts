#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bridge } from './bootstrap/bridgeRuntime.js';
import { ChartReadyReconciliationAdapter } from './bootstrap/ChartReadyReconciliationAdapter.js';
import { createProductionRuntime } from './bootstrap/runtime.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const runtime = createProductionRuntime();
  new ChartReadyReconciliationAdapter(runtime.reconcileChart).attach(bridge);

  await bridge.start();

  const server = createServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[romaco-mcp] MCP server ready — 27 tools registered');
  console.error('[romaco-mcp] Chart bridge tools need <McpBridge /> in browser');
  console.error('[romaco-mcp] Headless tools (analyze_market, find_levels, etc.) work without browser');
}

main().catch((err: unknown) => {
  console.error('[romaco-mcp] Fatal error:', err);
  process.exit(1);
});
