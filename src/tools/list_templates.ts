import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DRAWING_TEMPLATE_CATALOG } from '../data/templateCatalog.js';

/**
 * Headless tool — no browser bridge needed. Returns the full drawing-template
 * catalog so AI agents can pick the right `drawingType` for romaco_add_drawing
 * without parsing English descriptions out of the add_drawing tool blurb.
 */
export function registerListTemplates(server: McpServer): void {
  server.registerTool(
    'romaco_list_templates',
    {
      description:
        'List every drawing template available in romaco-charts, with category and required point count. Use this BEFORE romaco_add_drawing to choose a valid drawingType and know how many anchor points it expects.',
      inputSchema: {},
    },
    async () => {
      const text = JSON.stringify(DRAWING_TEMPLATE_CATALOG, null, 2);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
