/**
 * Directory MCP tools — register_agent, find_agents.
 *
 * Reference: SLICE-3-3, hackathon-flow.md:98-99, CONTEXT.md:73-75
 *
 * Both tools delegate to the same lower-level services as the REST route
 * handlers in routes/agents.ts (SLICE-2-1, SLICE-2-2).
 */

import { z } from "zod";
import { type NamespaceRegistry, getNamespace, type ToolResult } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}
import {
  getNftInfo,
  submitAuditMessage,
  submitDirectoryMessage,
} from "@agentbadge/hedera-core";
import type { DirectoryMessage } from "@agentbadge/hedera-core";
import { upsert, getAll, type DirectoryEntry } from "@agentbadge/passport";
import type { Capability, Tier, NftInfo } from "@agentbadge/hedera-core";

/** Input schema for register_agent. */
const registerAgentSchema = {
  did: z.string().min(1).describe("Agent DID (did:hcs:{tokenId}:{serial})"),
  tokenId: z.string().min(1).describe("HTS passport token ID"),
  serial: z.number().int().positive().describe("NFT serial number"),
  accountId: z.string().min(1).describe("Hedera account ID of the agent"),
  name: z.string().min(1).describe("Agent display name"),
  capabilities: z.array(z.string()).min(1).describe("Agent capabilities"),
  endpoint: z.string().min(1).describe("Agent HTTP endpoint URL"),
  tier: z.string().min(1).describe("Passport tier (bronze, silver, gold, platinum)"),
};

/** Input schema for find_agents. */
const findAgentsSchema = {
  capability: z
    .string()
    .optional()
    .describe(
      "Filter by capability (e.g. api_call, payment, data_provide, data_consume, orchestration)",
    ),
};

/** Directory entry with active flag for API responses. */
interface AgentWithActive extends DirectoryEntry {
  active: boolean;
}

/**
 * Batch-check NFT active status via Mirror Node.
 * `deleted: true` → `active: false` (CONTEXT.md:37).
 */
async function checkActiveStatus(entries: DirectoryEntry[]): Promise<AgentWithActive[]> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const nft = await getNftInfo(entry.tokenId, entry.serial);
        const active = nft ? !nft.deleted : false;
        return { ...entry, active };
      } catch {
        return { ...entry, active: false };
      }
    }),
  );
  return results;
}

/**
 * Register an agent in the directory.
 * Delegates to the same services as POST /agents/register.
 */
export async function registerAgent(args: Record<string, unknown>): Promise<ToolResult> {
  const did = args.did as string;
  const tokenId = args.tokenId as string;
  const serial = args.serial as number;
  const accountId = args.accountId as string;
  const name = args.name as string;
  const capabilities = args.capabilities as Capability[];
  const endpoint = args.endpoint as string;
  const tier = args.tier as Tier;

  if (!did || !tokenId || !serial || !accountId || !name || !capabilities || !endpoint || !tier) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Missing required fields: did, tokenId, serial, accountId, name, capabilities, endpoint, tier",
        },
      ],
    };
  }

  // 1. Verify passport ownership via Mirror Node
  let nft: NftInfo | null;
  try {
    nft = await getNftInfo(tokenId, serial);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mirror Node error";
    return {
      isError: true,
      content: [{ type: "text", text: `Passport verification failed: ${msg}` }],
    };
  }

  if (!nft) {
    return {
      isError: true,
      content: [{ type: "text", text: "Passport not found" }],
    };
  }
  if (nft.deleted) {
    return {
      isError: true,
      content: [{ type: "text", text: "Passport revoked" }],
    };
  }
  if (nft.account_id !== accountId) {
    return {
      isError: true,
      content: [{ type: "text", text: "Passport ownership mismatch" }],
    };
  }

  // 2. Submit directory message to HCS
  const timestamp = Math.floor(Date.now() / 1000);
  const dirMessage: DirectoryMessage = {
    type: "agent_register",
    did,
    tokenId,
    serial,
    accountId,
    name,
    capabilities,
    endpoint,
    tier,
    timestamp,
  };

  try {
    await submitDirectoryMessage(dirMessage);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "HCS submission error";
    return {
      isError: true,
      content: [{ type: "text", text: `Directory registration failed: ${msg}` }],
    };
  }

  // 3. Submit audit message
  try {
    await submitAuditMessage({
      type: "agent_registered",
      did,
      tokenId,
      serial,
      timestamp,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "HCS audit error";
    return {
      isError: true,
      content: [{ type: "text", text: `Audit submission failed: ${msg}` }],
    };
  }

  // 4. Update in-memory cache
  upsert({ did, tokenId, serial, accountId, name, capabilities, endpoint, tier, timestamp });

  return {
    content: [{ type: "text", text: JSON.stringify({ registered: true }) }],
  };
}

/**
 * Find agents in the directory, optionally filtered by capability.
 * Delegates to the same cache + Mirror Node check as GET /agents.
 */
export async function findAgents(args: Record<string, unknown>): Promise<ToolResult> {
  const capability = args.capability as Capability | undefined;

  let entries = getAll();

  if (capability) {
    entries = entries.filter((e) => e.capabilities.includes(capability));
  }

  const agents = await checkActiveStatus(entries);

  return {
    content: [{ type: "text", text: JSON.stringify({ agents }) }],
  };
}

/**
 * Register directory MCP tools on the MCP server.
 */
export function registerDirectoryTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "register_agent",
    "Register an agent in the HCS directory. Requires a valid passport NFT (ownership verified via Mirror Node). Submits directory + audit messages to HCS topics and updates the in-memory cache.",
    registerAgentSchema,
    registerAgent,
  );

  r.registerTool(
    "find_agents",
    "Find agents in the directory, optionally filtered by capability. Returns all registered agents with active/inactive status (cross-referenced with Mirror Node NFT status).",
    findAgentsSchema,
    findAgents,
  );
}
