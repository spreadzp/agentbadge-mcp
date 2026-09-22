import { z } from "zod";
import { type NamespaceRegistry, getNamespace, type ToolResult } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}
import {
  submitA2AMessage,
  getNftInfo,
  prepareA2ATopicMessage,
  signTransactionBytes,
  submitSignedTopicMessage,
} from "@agentbadge/hedera-core";
import { a2aUpsert as upsert, getMessagesByTo, getConversation } from "@agentbadge/passport";
import type { A2AMessage, CachedA2AMessage, NftInfo } from "@agentbadge/hedera-core";

function serviceErrorToMcpError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function parseDid(did: string): { tokenId: string; serial: number } | null {
  const parts = did.split(":");
  if (parts.length !== 4 || parts[0] !== "did" || parts[1] !== "hcs") return null;
  const tokenId = parts[2];
  const serial = Number(parts[3]);
  if (!tokenId || Number.isNaN(serial) || serial < 1) return null;
  return { tokenId, serial };
}

async function verifyPassport(did: string): Promise<{ valid: boolean; reason?: string }> {
  const parsed = parseDid(did);
  if (!parsed) return { valid: false, reason: "Invalid DID format" };
  let nft: NftInfo | null;
  try {
    nft = await getNftInfo(parsed.tokenId, parsed.serial);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mirror Node error";
    return { valid: false, reason: `Passport verification failed: ${msg}` };
  }
  if (!nft) return { valid: false, reason: "passport not found" };
  if (nft.deleted) return { valid: false, reason: "passport revoked" };
  return { valid: true };
}

function paginate<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}

function getMessageDirection(
  from: string,
  to: string,
  didA: string,
  didB: string,
): string {
  if (from === didA && to === didB) return "A→B";
  return "B→A";
}

const sendMessageArgsSchema = z.object({
  from: z.string().min(1).describe("Sender DID (did:hcs:tokenId:serial)"),
  to: z.string().min(1).describe("Recipient DID"),
  body: z.string().min(1).max(4096).describe("Message content"),
  contentType: z.string().optional().default("text/plain").describe("Content type"),
});

const sendMessageWithKeyArgsSchema = z.object({
  from: z.string().min(1).describe("Sender DID (did:hcs:tokenId:serial)"),
  to: z.string().min(1).describe("Recipient DID"),
  body: z.string().min(1).max(4096).describe("Message content"),
  contentType: z.string().optional().default("text/plain").describe("Content type"),
  fromAccountId: z.string().min(1).describe("Sender Hedera account ID (e.g. 0.0.1234)"),
  privateKey: z.string().min(1).describe("Sender Ed25519 private key (hex or DER)"),
});

const getInboxArgsSchema = z.object({
  did: z.string().min(1).describe("Agent DID"),
  limit: z.number().optional().default(50).describe("Max messages (1-100)"),
  offset: z.number().optional().default(0).describe("Pagination offset"),
});

const getConversationArgsSchema = z.object({
  didA: z.string().min(1).describe("First agent DID (did:hcs:tokenId:serial)"),
  didB: z.string().min(1).describe("Second agent DID"),
  limit: z.number().optional().default(50).describe("Max messages (1-100)"),
  offset: z.number().optional().default(0).describe("Pagination offset"),
});

export async function sendMessageHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = sendMessageArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Validation error: ${parsed.error.message}` },
      ],
    };
  }

  const { from, to, body, contentType } = parsed.data;

  const senderCheck = await verifyPassport(from);
  if (!senderCheck.valid) {
    return {
      isError: true,
      content: [{ type: "text", text: `Sender ${senderCheck.reason}` }],
    };
  }

  const recipientCheck = await verifyPassport(to);
  if (!recipientCheck.valid) {
    return {
      isError: true,
      content: [{ type: "text", text: `Recipient ${recipientCheck.reason}` }],
    };
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const message: A2AMessage = {
      type: "a2a_message",
      from,
      to,
      body,
      contentType: contentType || "text/plain",
      timestamp,
    };
    const receipt = await submitA2AMessage(message);

    const cached: CachedA2AMessage = {
      ...message,
      txId: receipt.txId,
      consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    };
    upsert(cached);

    return ok({ txId: receipt.txId, timestamp });
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function sendMessageWithKeyHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = sendMessageWithKeyArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Validation error: ${parsed.error.message}` },
      ],
    };
  }

  const { from, to, body, contentType, fromAccountId, privateKey } = parsed.data;

  const senderCheck = await verifyPassport(from);
  if (!senderCheck.valid) {
    return {
      isError: true,
      content: [{ type: "text", text: `Sender ${senderCheck.reason}` }],
    };
  }

  const recipientCheck = await verifyPassport(to);
  if (!recipientCheck.valid) {
    return {
      isError: true,
      content: [{ type: "text", text: `Recipient ${recipientCheck.reason}` }],
    };
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const message: A2AMessage = {
      type: "a2a_message",
      from,
      to,
      body,
      contentType: contentType || "text/plain",
      timestamp,
    };

    const { txBytes } = await prepareA2ATopicMessage(fromAccountId, message);
    const { signature, publicKey } = signTransactionBytes(txBytes, privateKey);
    const sigB64Array = JSON.parse(signature) as string[];
    const signatureBytes = sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
    const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

    const cached: CachedA2AMessage = {
      ...message,
      txId,
      consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    };
    upsert(cached);

    return ok({ txId, timestamp });
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function getInboxHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getInboxArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Validation error: ${parsed.error.message}` },
      ],
    };
  }

  const { did, limit, offset } = parsed.data;

  if (!parseDid(did)) {
    return {
      isError: true,
      content: [{ type: "text", text: "Invalid DID format" }],
    };
  }

  try {
    const allMessages = getMessagesByTo(did);
    const messages = paginate(allMessages, limit, offset);

    return ok({ messages, count: messages.length, total: allMessages.length });
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function getConversationHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getConversationArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Validation error: ${parsed.error.message}` },
      ],
    };
  }

  const { didA, didB, limit, offset } = parsed.data;

  if (!parseDid(didA) || !parseDid(didB)) {
    return {
      isError: true,
      content: [{ type: "text", text: "Invalid DID format" }],
    };
  }

  if (didA === didB) {
    return {
      isError: true,
      content: [{ type: "text", text: "didA and didB must be different" }],
    };
  }

  try {
    const allMessages = getConversation(didA, didB);
    const total = allMessages.length;
    const messages = paginate(allMessages, limit, offset);

    const messagesWithDirection = messages.map((msg) => ({
      ...msg,
      direction: getMessageDirection(msg.from, msg.to, didA, didB),
    }));

    return ok({
      didA,
      didB,
      messages: messagesWithDirection,
      count: messages.length,
      total,
      limit,
      offset,
    });
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export function registerA2ATools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "send_message",
    "Send a message to another agent via A2A messaging (server-key, deprecated). Use send_message_with_key for agent-signed messages.",
    {
      from: z.string().min(1).describe("Sender DID (did:hcs:tokenId:serial)"),
      to: z.string().min(1).describe("Recipient DID"),
      body: z.string().min(1).max(4096).describe("Message content"),
      contentType: z
        .string()
        .optional()
        .describe("Content type (default: text/plain)"),
    },
    sendMessageHandler,
  );

  r.registerTool(
    "send_message_with_key",
    "Send a signed message to another agent via A2A messaging. Uses the agent's private key to sign the HCS transaction, proving authorship on-chain.",
    {
      from: z.string().min(1).describe("Sender DID (did:hcs:tokenId:serial)"),
      to: z.string().min(1).describe("Recipient DID"),
      body: z.string().min(1).max(4096).describe("Message content"),
      contentType: z
        .string()
        .optional()
        .describe("Content type (default: text/plain)"),
      fromAccountId: z
        .string()
        .min(1)
        .describe("Sender Hedera account ID (e.g. 0.0.1234)"),
      privateKey: z
        .string()
        .min(1)
        .describe("Sender Ed25519 private key (hex or DER)"),
    },
    sendMessageWithKeyHandler,
  );

  r.registerTool(
    "get_inbox",
    "Get inbox messages for an agent. Returns messages sorted by timestamp with pagination.",
    {
      did: z.string().min(1).describe("Agent DID"),
      limit: z.number().optional().describe("Max messages (1-100, default: 50)"),
      offset: z.number().optional().describe("Pagination offset (default: 0)"),
    },
    getInboxHandler,
  );

  r.registerTool(
    "get_conversation",
    "Get conversation history between two agents. Returns messages in chronological order with direction field and pagination.",
    {
      didA: z
        .string()
        .min(1)
        .describe("First agent DID (did:hcs:tokenId:serial)"),
      didB: z.string().min(1).describe("Second agent DID"),
      limit: z.number().optional().describe("Max messages (1-100, default: 50)"),
      offset: z.number().optional().describe("Pagination offset (default: 0)"),
    },
    getConversationHandler,
  );
}
