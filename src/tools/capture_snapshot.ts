import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';

export function registerCaptureSnapshot(server: McpServer): void {
  server.registerTool(
    'romaco_capture_snapshot',
    {
      description:
        'Capture the current chart as a base64 image for vision-enabled models. ' +
        'Cost: 300–800 KB per image (PNG, lossless) or 100–300 KB (JPEG). Gated. ' +
        'Set acknowledgeHighTokenCost:true to receive the image. Without it the tool returns an error explaining the cost. ' +
        'Only opt in when the USER explicitly asked for a visual snapshot — e.g. to share, to confirm placement, or to feed a vision LLM.',
      inputSchema: {
        format: z
          .enum(['png', 'jpeg'])
          .optional()
          .describe('Image format: png (default, lossless) or jpeg (smaller file).'),
        acknowledgeHighTokenCost: z
          .literal(true)
          .optional()
          .describe(
            'REQUIRED to receive the image. Setting this true commits to 300–800 KB base64 PNG (or 100–300 KB JPEG). ' +
            'Only opt in when the USER explicitly asked for a chart image and accepts the token cost.',
          ),
      },
    },
    async ({ format, acknowledgeHighTokenCost }) => {
      if (acknowledgeHighTokenCost !== true) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'romaco_capture_snapshot is gated. A chart snapshot returns 300–800 KB of base64 image data. ' +
                'If the user explicitly asked for a visual snapshot, re-call this tool with acknowledgeHighTokenCost:true. ' +
                'For programmatic analysis use romaco_analyze_market, romaco_find_levels, or romaco_detect_patterns instead — they return ~500 tokens of compressed features.',
            },
          ],
          isError: true,
        };
      }
      let dataUrl: string;
      try {
        dataUrl = await bridge.captureSnapshot(format ?? 'png');
      } catch (err) {
        const { text, isError } = enrichBridgeResult('romaco_capture_snapshot', {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return { content: [{ type: 'text' as const, text }], isError };
      }
      const mimeType = (format ?? 'png') === 'jpeg' ? 'image/jpeg' : 'image/png';
      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      return {
        content: [
          { type: 'image' as const, data: base64, mimeType },
          { type: 'text' as const, text: `Chart snapshot captured (${mimeType})` },
        ],
      };
    },
  );
}
