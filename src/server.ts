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

/**
 * Verified caller identity, resolved at the transport boundary
 * (EPIC-259 SLICE-259-4). Passed to handlers that do subject-level
 * authorization — e.g. ownership checks that must come from verified
 * context, never from tool arguments.
 */
export interface ToolCallContext {
  callerTier?: "anonymous" | "authenticated" | "admin";
  /** DID verified by transport middleware (did:hcs:{tokenId}:{serial}). */
  verifiedDid?: string;
  /** agentId from an agb_ API key record. */
  agentId?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx?: ToolCallContext,
) => Promise<ToolResult>;

type ZodRawShape = Record<string, z.ZodType>;

/**
 * Exposure tier for a registered tool (D-259-Q2).
 * - "public": callable anonymously (read/discover/onboard only)
 * - "authenticated": requires a verified caller identity (agb_ key / DID)
 * - "admin": operator surface only — never callable on public transports
 * Default is "admin" (deny-by-default): unclassified tools are not exposed.
 */
export type ToolExposure = "public" | "authenticated" | "admin";

export type PublicTier = "curated" | "extended";

export interface ToolRegistrationOptions {
  exposure?: ToolExposure;
  /** Discovery projection for exposure:"public" tools (SLICE-259-7):
   *  "curated" → listed to anonymous callers; anything else defaults
   *  to "extended" — callable but absent from the anon tools/list.
   *  Ignored for non-public exposures. */
  publicTier?: PublicTier;
}

interface ToolEntry {
  name: string;
  description: string;
  schema: z.ZodObject<ZodRawShape>;
  handler: ToolHandler;
  exposure: ToolExposure;
  publicTier: PublicTier;
}

export interface ToolListing {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  exposure: ToolExposure;
  publicTier: PublicTier;
}

const serverInstructions = (toolCount: number) =>
  "AgentBadge MCP — agent-readiness scanning, on-chain passport NFTs (Hedera/EVM), " +
  "agent discovery directory, marketplace tools, audit trail and x402-paid scan packs. " +
  `Docs: https://agentbadge.xyz — ${toolCount} tools across passport, discovery, marketplace, audit, bstock, circle-payments namespaces.`;

// ─── NamespaceRegistry ───────────────────────────────────────────

export class NamespaceRegistry {
  private toolRegistry = new Map<string, ToolEntry>();
  private mcpServer: McpServer;
  private httpTransport: WebStandardStreamableHTTPServerTransport | null = null;

  constructor(private name: string, private version = "0.1.0") {
    this.mcpServer = new McpServer({ name, version }, { instructions: serverInstructions(0) });
  }

  // Instructions embed the live tool count — refresh before each connect so
  // clients never see the stale constructor-time value.
  private syncInstructions(): void {
    const server = this.mcpServer.server as unknown as { _instructions?: string };
    server._instructions = serverInstructions(this.toolRegistry.size);
  }

  registerTool(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    handler: ToolHandler,
    options?: ToolRegistrationOptions,
  ): void {
    const schema = z.object(inputSchema);
    const exposure = options?.exposure ?? "admin";
    // publicTier is curated only when explicitly marked; deny-by-default
    // spirit — a new public tool does not enter the anon catalog silently.
    const publicTier: PublicTier =
      exposure === "public" && options?.publicTier === "curated"
        ? "curated"
        : "extended";
    this.toolRegistry.set(name, {
      name,
      description,
      schema,
      handler,
      exposure,
      publicTier,
    });
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
    return Array.from(this.toolRegistry.values()).map(
      ({ name, description, schema, exposure, publicTier }) => ({
        name,
        description,
        inputSchema: zodToJsonSchema(schema.shape),
        exposure,
        publicTier,
      }),
    );
  }

  async handleHttpToolCall(
    toolName: string,
    args: Record<string, unknown>,
    ctx?: ToolCallContext,
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
      return await tool.handler(parsed as Record<string, unknown>, ctx);
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
    this.syncInstructions();
    await this.mcpServer.connect(transport);
  }

  private createHttpTransport(): WebStandardStreamableHTTPServerTransport {
    if (this.httpTransport) return this.httpTransport;

    this.httpTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    this.syncInstructions();
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
      { instructions: serverInstructions(this.toolRegistry.size) },
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
  options?: ToolRegistrationOptions,
): void {
  defaultNamespace.registerTool(name, description, inputSchema, handler, options);
}

export function listTools(): ToolListing[] {
  return defaultNamespace.listTools();
}

export async function handleHttpToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx?: ToolCallContext,
): Promise<ToolResult> {
  return defaultNamespace.handleHttpToolCall(toolName, args, ctx);
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
