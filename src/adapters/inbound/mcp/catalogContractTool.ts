import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  registerContractTool,
  type ContractToolExecutionContext,
  type ContractToolOutcome,
  type RegisterContractToolOptions,
} from './contracts.js';
import { ROMACO_TOOL_CATALOG_BY_NAME, type RomacoToolName } from './toolCatalog.js';

export interface CatalogContractConfig<
  InputSchema extends z.AnyZodObject,
  DataSchema extends z.AnyZodObject,
> {
  description: string;
  inputSchema: InputSchema;
  dataSchema: DataSchema;
  contractVersion?: string;
}

export function registerCatalogContractTool<
  InputSchema extends z.AnyZodObject,
  DataSchema extends z.AnyZodObject,
>(
  server: McpServer,
  name: RomacoToolName,
  config: CatalogContractConfig<InputSchema, DataSchema>,
  handler: (
    input: z.output<InputSchema>,
    context: ContractToolExecutionContext,
  ) => Promise<ContractToolOutcome<z.output<DataSchema>>> | ContractToolOutcome<z.output<DataSchema>>,
  options: RegisterContractToolOptions = {},
): RegisteredTool {
  const catalog = ROMACO_TOOL_CATALOG_BY_NAME.get(name);
  if (!catalog) throw new Error(`Missing MCP contract catalog entry for ${name}.`);
  return registerContractTool(
    server,
    {
      name,
      title: catalog.title,
      description: config.description,
      inputSchema: config.inputSchema,
      dataSchema: config.dataSchema,
      annotations: catalog.annotations,
      risk: catalog.risk,
      contractVersion: config.contractVersion,
    },
    handler,
    options,
  );
}
