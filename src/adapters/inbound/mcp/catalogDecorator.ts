import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ROMACO_TOOL_CATALOG_BY_NAME, type RomacoToolName } from './toolCatalog.js';

/**
 * Decorate registrations centrally so legacy and migrated handlers advertise
 * one authoritative title/risk surface without 27 metadata-only edits.
 */
export function decorateServerWithToolCatalog(server: McpServer): McpServer {
  const registerTool = server.registerTool.bind(server);

  server.registerTool = ((name, config, callback) => {
    const entry = ROMACO_TOOL_CATALOG_BY_NAME.get(name as RomacoToolName);
    if (!entry) {
      throw new Error(`Public MCP tool ${name} is missing from ROMACO_TOOL_CATALOG.`);
    }
    const structured = config.outputSchema !== undefined;
    return registerTool(
      name,
      {
        ...config,
        title: entry.title,
        annotations: entry.annotations,
        _meta: {
          ...config._meta,
          'io.romaco/risk': entry.risk,
          ...(structured
            ? {
                'io.romaco/output-contract': {
                  schemaId: entry.output.schemaId,
                  contentKinds: entry.output.contentKinds,
                  status: 'structured',
                },
              }
            : {
                'io.romaco/output-migration': {
                  schemaId: entry.output.schemaId,
                  status: 'legacy',
                },
              }),
        },
      },
      callback,
    );
  }) as typeof server.registerTool;

  return server;
}
