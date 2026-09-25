import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { zodToJsonSchema } from "./lib/zod-to-json-schema.js";

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

type ZodRawShape = Record<string, z.ZodType>;

interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodObject<ZodRawShape>;
  handler: ToolHandler;
}

export interface ToolListing {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const SERVER_INSTRUCTIONS =
  "AgentBadge MCP — agent-readiness scanning, on-chain passport NFTs (Hedera/EVM), " +
  "agent discovery directory, marketplace tools, audit trail and x402-paid scan packs. " +
  "Docs: https://agentbadge.xyz — 52 tools across passport, discovery, marketplace, audit, bstock, circle-payments namespaces.";

// ─── NamespaceRegistry ───────────────────────────────────────────

export class NamespaceRegistry {
  private toolRegistry = new Map<string, ToolEntry>();
  private mcpServer: McpServer;
  private httpTransport: WebStandardStreamableHTTPServerTransport | null = null;

  constructor(private name: string, private version = "0.1.0") {
    this.mcpServer = new McpServer({ name, version }, { instructions: SERVER_INSTRUCTIONS });
  }

  registerTool(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    handler: ToolHandler,
  ): void {
    const schema = z.object(inputSchema);
    this.toolRegistry.set(name, { name, description, schema, handler });
    try {
      this.mcpServer.registerTool(
        name,
        { description, inputSchema },
        async (args: Record<string, unknown>) => handler(args),
      );
    } catch {
      // Tool already registered on MCP server — update registry only
    }
  }

  listTools(): ToolListing[] {
    return Array.from(this.toolRegistry.values()).map(({ name, description, schema }) => ({
      name,
      description,
      inputSchema: zodToJsonSchema(schema.shape),
    }));
  }

  async handleHttpToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool '${toolName}' not found` }],
      };
    }

    try {
      const parsed = tool.schema.parse(args);
      return await tool.handler(parsed as Record<string, unknown>);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid arguments";
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  private createHttpTransport(): WebStandardStreamableHTTPServerTransport {
    if (this.httpTransport) return this.httpTransport;

    this.httpTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    this.mcpServer.connect(this.httpTransport);
    return this.httpTransport;
  }

  async resetHttpTransport(): Promise<void> {
    if (this.httpTransport) {
      try {
        await this.httpTransport.close();
      } catch {
        // Ignore close errors
      }
    }
    try {
      await this.mcpServer.close();
    } catch {
      // Ignore close errors
    }
    this.httpTransport = null;

    this.mcpServer = new McpServer(
      { name: this.name, version: this.version },
      { instructions: SERVER_INSTRUCTIONS },
    );

    for (const [name, entry] of this.toolRegistry) {
      try {
        this.mcpServer.registerTool(
          name,
          { description: entry.description, inputSchema: entry.schema.shape },
          async (args: Record<string, unknown>) => entry.handler(args),
        );
      } catch (e) {
        console.error(`[MCP] Failed to re-register tool '${name}':`, e);
      }
    }

    this.httpTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await this.mcpServer.connect(this.httpTransport);
  }

  async handleHttpRequest(request: Request): Promise<Response> {
    try {
      const cloned = request.clone();
      const body = await cloned.json();
      if (body.method === "initialize" && this.httpTransport) {
        await this.resetHttpTransport();
      }
    } catch {
      // Not JSON or no method field — proceed normally
    }

    const transport = this.createHttpTransport();
    return transport.handleRequest(request);
  }
}

// ─── Namespace factory ───────────────────────────────────────────

const namespaces = new Map<string, NamespaceRegistry>();

export function createNamespace(name: string): NamespaceRegistry {
  if (namespaces.has(name)) return namespaces.get(name)!;
  const ns = new NamespaceRegistry(name);
  namespaces.set(name, ns);
  return ns;
}

export function getNamespace(name: string): NamespaceRegistry | undefined {
  return namespaces.get(name);
}

export function listAllNamespaces(): string[] {
  return Array.from(namespaces.keys());
}

// ─── Backward-compatible global registry ─────────────────────────

const defaultNamespace = createNamespace("all");

export function registerTool(
  name: string,
  description: string,
  inputSchema: ZodRawShape,
  handler: ToolHandler,
): void {
  defaultNamespace.registerTool(name, description, inputSchema, handler);
}

export function listTools(): ToolListing[] {
  return defaultNamespace.listTools();
}

export async function handleHttpToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return defaultNamespace.handleHttpToolCall(toolName, args);
}

export async function startStdio(): Promise<void> {
  return defaultNamespace.startStdio();
}

export async function resetHttpTransport(): Promise<void> {
  return defaultNamespace.resetHttpTransport();
}

export async function handleHttpRequest(request: Request): Promise<Response> {
  return defaultNamespace.handleHttpRequest(request);
}

// Backward-compatible mcpServer export — exposes the default namespace's McpServer instance.
// Uses a getter object so that resetHttpTransport() (which replaces the internal instance) is reflected.
// We expose the internal mcpServer via a method on NamespaceRegistry for this purpose.
Object.defineProperty(NamespaceRegistry.prototype, "_getMcpServer", {
  value: function () { return this.mcpServer; },
  enumerable: false,
});

type McpServerProxy = {
  name: string;
  version: string;
  connect: (...args: any[]) => Promise<void>;
  close: (...args: any[]) => Promise<void>;
  registerTool: (...args: any[]) => any;
  getTool: (...args: any[]) => any;
  removeTool: (...args: any[]) => any;
  listTools: (...args: any[]) => any;
  callTool: (...args: any[]) => any;
  sendToolListChanged: (...args: any[]) => void;
};

export const mcpServer: McpServerProxy = {
  get name() { return (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().name; },
  get version() { return (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().version; },
  connect: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().connect(...args),
  close: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().close(...args),
  registerTool: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().registerTool(...args),
  getTool: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().getTool(...args),
  removeTool: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().removeTool(...args),
  listTools: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().listTools(...args),
  callTool: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().callTool(...args),
  sendToolListChanged: (...args: any[]) => (defaultNamespace as unknown as { _getMcpServer: () => McpServerProxy })._getMcpServer().sendToolListChanged(...args),
};
