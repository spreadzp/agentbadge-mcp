/**
 * Audit trail service — reads HCS passport.audit topic messages.
 *
 * Reference: CONTEXT.md:85-87 (§Audit Trail)
 * Only 5 state-change event types are valid; reads are never logged.
 */

import { z } from "zod";
import { type NamespaceRegistry, getNamespace } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}
import { getTopicMessages } from "@agentbadge/hedera-core";
import { getCatalog } from "@agentbadge/hedera-core";
import type { AuditMessage } from "@agentbadge/hedera-core";

const VALID_EVENT_TYPES = new Set([
  "passport_issued",
  "tier_upgraded",
  "passport_revoked",
  "agent_registered",
  "agent_deregistered",
]);

/**
 * Fetch audit events from the HCS audit topic, optionally filtered by
 * tokenId and/or serial number.
 *
 * @param tokenId  Optional token ID filter
 * @param serial   Optional serial number filter
 * @returns        Chronologically ordered list of audit events
 */
export async function getAuditTrail(tokenId?: string, serial?: number): Promise<AuditMessage[]> {
  const auditTopicId = process.env.AUDIT_TOPIC_ID ?? "0.0.0";
  const messages = await getTopicMessages(auditTopicId);

  const events: AuditMessage[] = [];
  for (const msg of messages) {
    try {
      const parsed = JSON.parse(msg.message) as Record<string, unknown>;
      if (!VALID_EVENT_TYPES.has(parsed.type as string)) continue;

      const event = parsed as unknown as AuditMessage;
      if (tokenId && event.tokenId !== tokenId) continue;
      if (serial !== undefined && event.serial !== serial) continue;

      events.push(event);
    } catch {
      // Skip malformed messages
    }
  }

  // Reverse to chronological order (mirror returns desc by default)
  events.reverse();
  return events;
}

/**
 * Register audit + catalog MCP tools on the MCP server.
 */
export function registerAuditCatalogTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  // get_audit_trail tool
  r.registerTool(
    "get_audit_trail",
    "Get the audit trail for a passport, optionally filtered by tokenId and serial. Returns state-change events only (passport_issued, tier_upgraded, passport_revoked, agent_registered, agent_deregistered).",
    {
      tokenId: z.string().optional().describe("Filter by token ID"),
      serial: z.number().optional().describe("Filter by serial number"),
    },
    async (args) => {
      const tokenId = args.tokenId as string | undefined;
      const serial = args.serial as number | undefined;
      const events = await getAuditTrail(tokenId, serial);
      return {
        content: [{ type: "text", text: JSON.stringify({ events }) }],
      };
    },
  );

  // get_tier_requirements tool
  r.registerTool(
    "get_tier_requirements",
    "Get the passport tier catalog with pricing and capabilities for all 4 tiers (bronze, silver, gold, platinum).",
    {},
    async () => {
      const tiers = getCatalog();
      return {
        content: [{ type: "text", text: JSON.stringify({ tiers }) }],
      };
    },
  );
}
