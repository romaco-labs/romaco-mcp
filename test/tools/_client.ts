// Shared helper: spin up an in-memory MCP server + client pair for
// schema/handler integration tests. No stdio process, no WS bridge.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';

export async function createTestClient(): Promise<{
  client: Client;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<{
    isError: boolean;
    text: string;
    raw: Awaited<ReturnType<Client['callTool']>>;
  }>;
  close: () => Promise<void>;
}> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    client,
    callTool: async (name, args = {}) => {
      const raw = await client.callTool({ name, arguments: args });
      const content = (raw.content ?? []) as Array<{ type: string; text?: string }>;
      const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
      return { isError: raw.isError === true, text, raw };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
