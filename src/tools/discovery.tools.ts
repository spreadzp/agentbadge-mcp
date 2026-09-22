import { z } from "zod";
import { type NamespaceRegistry, getNamespace, type ToolResult } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;

function serviceErrorToMcpError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

// ─── get_agent_card ──────────────────────────────────────────────

async function getAgentCardHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const res = await fetch(`${SERVER_URL}/.well-known/agent-card.json`);
    if (!res.ok) {
      throw new Error(`Failed to fetch agent card: HTTP ${res.status}`);
    }
    const card = await res.json();
    return {
      content: [{ type: "text", text: JSON.stringify(card, null, 2) }],
    };
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

// ─── search_agents ───────────────────────────────────────────────

const searchAgentsArgsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Search query string (e.g. 'payment', 'data_provide')"),
  type: z
    .string()
    .optional()
    .describe("Filter by capability type (api_call, payment, data_provide, data_consume, orchestration)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results (default: 20)"),
});

async function searchAgentsHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = searchAgentsArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { query, type, limit } = parsed.data;

  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    if (limit) params.set("limit", String(limit));

    const url = `${SERVER_URL}/api/search${params.size > 0 ? `?${params}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Search failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

// ─── get_server_info ─────────────────────────────────────────────

async function getServerInfoHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const res = await fetch(`${SERVER_URL}/llms.txt`);
    if (!res.ok) {
      throw new Error(`Failed to fetch llms.txt: HTTP ${res.status}`);
    }
    const text = await res.text();
    return {
      content: [{ type: "text", text }],
    };
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

// ─── get_ai_sitemap ──────────────────────────────────────────────

async function getAiSitemapHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const res = await fetch(`${SERVER_URL}/ai-sitemap.xml`);
    if (!res.ok) {
      throw new Error(`Failed to fetch ai-sitemap: HTTP ${res.status}`);
    }
    const xml = await res.text();
    return {
      content: [{ type: "text", text: xml }],
    };
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

// ─── Registration ────────────────────────────────────────────────

export function registerDiscoveryTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "get_agent_card",
    "Fetch the server's Agent Card (/.well-known/agent-card.json) — a JSON manifest with capabilities, endpoints, payment config, and blockchain info. Start here to discover what the server offers.",
    {},
    getAgentCardHandler,
  );

  r.registerTool(
    "search_agents",
    "Search for registered agents by query string or capability type. Fetches /api/search with optional query, type, and limit parameters.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query string (e.g. 'payment', 'data_provide')"),
      type: z
        .string()
        .optional()
        .describe("Filter by capability type (api_call, payment, data_provide, data_consume, orchestration)"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default: 20)"),
    },
    searchAgentsHandler,
  );

  r.registerTool(
    "get_server_info",
    "Fetch the server's llms.txt — a plain-text API specification for LLMs. Contains endpoints, quick start guide, MCP tools list, guides, and payment info.",
    {},
    getServerInfoHandler,
  );

  r.registerTool(
    "get_ai_sitemap",
    "Fetch the AI sitemap (/ai-sitemap.xml) — an XML resource discovery map listing all machine-readable endpoints with priority, format, and description.",
    {},
    getAiSitemapHandler,
  );
}

export {
  getAgentCardHandler,
  searchAgentsHandler,
  getServerInfoHandler,
  getAiSitemapHandler,
};
