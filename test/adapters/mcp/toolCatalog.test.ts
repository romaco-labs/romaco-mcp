import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../../src/server.js';
import {
  ROMACO_TOOL_CATALOG,
  ROMACO_TOOL_CATALOG_BY_NAME,
} from '../../../src/adapters/inbound/mcp/toolCatalog.js';

describe('27-tool contract catalog', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'catalog-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    closeServer = () => server.close();
  });

  afterEach(async () => {
    await client.close();
    await closeServer();
  });

  it('covers every currently registered public tool exactly once', async () => {
    const advertised = await client.listTools();
    const actualNames = advertised.tools.map((tool) => tool.name).sort();
    const catalogNames = ROMACO_TOOL_CATALOG.map((tool) => tool.name).sort();

    expect(ROMACO_TOOL_CATALOG).toHaveLength(27);
    expect(new Set(catalogNames).size).toBe(27);
    expect(catalogNames).toEqual(actualNames);
    expect(ROMACO_TOOL_CATALOG_BY_NAME.size).toBe(27);
  });

  it('assigns unique schemas and complete metadata to every tool', () => {
    const schemaIds = new Set<string>();
    for (const tool of ROMACO_TOOL_CATALOG) {
      expect(tool.title.length).toBeGreaterThan(2);
      expect(tool.output.summary.length).toBeGreaterThan(10);
      expect(tool.output.dataFields.length).toBeGreaterThan(0);
      expect(tool.output.contentKinds).toContain('text');
      expect(tool.annotations).toEqual({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
      expect(['low', 'medium', 'high']).toContain(tool.risk.level);
      expect(['none', 'explicit-user-intent', 'confirmation-token']).toContain(tool.risk.approval);
      expect(schemaIds.has(tool.output.schemaId)).toBe(false);
      schemaIds.add(tool.output.schemaId);
    }
  });

  it('advertises output contracts only for the thirteen actually structured tools', async () => {
    const advertised = await client.listTools();
    expect(advertised.tools.filter((tool) => tool.outputSchema)).toHaveLength(13);
    for (const tool of advertised.tools) {
      const entry = ROMACO_TOOL_CATALOG_BY_NAME.get(tool.name as never);
      expect(entry).toBeTruthy();
      expect(tool.title).toBe(entry!.title);
      expect(tool.annotations).toEqual(entry!.annotations);
      expect(tool._meta?.['io.romaco/risk']).toEqual(entry!.risk);
      if (tool.outputSchema) {
        expect(tool._meta?.['io.romaco/output-contract']).toEqual({
          schemaId: entry!.output.schemaId,
          contentKinds: entry!.output.contentKinds,
          status: 'structured',
        });
        expect(tool._meta?.['io.romaco/output-migration']).toBeUndefined();
      } else {
        expect(tool._meta?.['io.romaco/output-contract']).toBeUndefined();
        expect(tool._meta?.['io.romaco/output-migration']).toEqual({
          schemaId: entry!.output.schemaId,
          status: 'legacy',
        });
      }
    }
  });

  it('never labels destructive tools as low risk with no approval policy', () => {
    const unsafe = ROMACO_TOOL_CATALOG.filter(
      (tool) => tool.annotations.destructiveHint
        && tool.risk.level === 'low'
        && tool.risk.approval === 'none',
    );
    expect(unsafe).toEqual([]);
  });
});
