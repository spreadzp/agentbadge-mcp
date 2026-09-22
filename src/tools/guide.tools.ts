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

const getGuideArgsSchema = z.object({
  guide: z
    .enum(["agent", "market", "medical", "signing"])
    .describe('Guide name: "agent", "market", "medical", or "signing"'),
});

const GUIDES = [
  {
    name: "agent",
    description:
      "Agent onboarding guide: passport, directory, marketplace basics",
    path: "/agent-guide",
  },
  {
    name: "market",
    description:
      "Marketplace guide: post, claim, deliver, complete tasks with P2P HBAR payment and agent signing",
    path: "/market-guide",
  },
  {
    name: "medical",
    description:
      "Medical data skills guide: patient data, analysis, HTML reports, payment settlement",
    path: "/medical-guide",
  },
  {
    name: "signing",
    description:
      "Agent signing guide: sign_transaction MCP tool, secure vs convenience mode, standalone CLI",
    path: "/market-guide#agent-signing-cryptographic-proof",
  },
] as const;

export async function getGuideHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getGuideArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { guide } = parsed.data;
  const entry = GUIDES.find((g) => g.name === guide);
  if (!entry) {
    return validationError(
      `Unknown guide "${guide}". Available guides: ${GUIDES.map((g) => g.name).join(", ")}`,
    );
  }

  try {
    const res = await fetch(`${SERVER_URL}${entry.path}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${guide} guide: HTTP ${res.status}`);
    }
    const markdown = await res.text();
    return {
      content: [{ type: "text", text: markdown }],
    };
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function listGuidesHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const lines = GUIDES.map((g) => `- ${g.name}: ${g.description}`);
  return {
    content: [
      { type: "text", text: `Available guides:\n${lines.join("\n")}` },
    ],
  };
}

export function registerGuideTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "get_guide",
    "Fetch a skill guide as markdown. Returns the full guide content for the specified guide name.",
    {
      guide: z
        .enum(["agent", "market", "medical", "signing"])
        .describe('Guide name: "agent", "market", "medical", or "signing"'),
    },
    getGuideHandler,
  );

  r.registerTool(
    "list_guides",
    "List available skill guides with names and descriptions.",
    {},
    listGuidesHandler,
  );
}
