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

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as Record<string, unknown>;
}

async function apiGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}${path}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as Record<string, unknown>;
}

const postTaskArgsSchema = z.object({
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  title: z.string().min(1).max(200).describe("Task title"),
  description: z.string().min(1).max(4096).describe("Task description"),
  priceHbar: z.number().positive().describe("Price in HBAR"),
  capabilities: z.array(z.string()).min(1).describe("Required capabilities"),
  deadline: z.number().optional().describe("Deadline as unix timestamp"),
});

const listTasksArgsSchema = z.object({
  capability: z.string().optional().describe("Filter by capability"),
  limit: z.number().optional().default(50).describe("Max tasks (default: 50)"),
  offset: z.number().optional().default(0).describe("Pagination offset"),
});

const claimTaskArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to claim"),
  claimerDid: z.string().min(1).describe("Claimer DID"),
});

const deliverResultArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID"),
  claimerDid: z.string().min(1).describe("Claimer DID"),
  resultBody: z.string().max(4096).optional().describe("Result content (max 4KB)"),
  resultIpfs: z.string().optional().describe("IPFS CID for large results"),
});

const preparePaymentArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to prepare payment for"),
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
});

const completeTaskArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to complete"),
  posterDid: z.string().min(1).describe("Poster DID"),
  txBytes: z.string().optional().describe("Base64-encoded frozen transaction bytes from prepare_payment"),
  publicKey: z.string().optional().describe("Signer's public key (DER-encoded hex)"),
  signature: z.string().optional().describe("Base64-encoded signature of the transaction bytes"),
  posterPrivateKey: z.string().optional().describe("Poster's private key (legacy mode, not recommended)"),
});

export async function postTaskHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = postTaskArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { posterDid, title, description, priceHbar, capabilities, deadline } = parsed.data;

  try {
    const result = await apiPost("/market/tasks", {
      posterDid,
      title,
      description,
      priceHbar,
      capabilities,
      deadline,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function listTasksHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = listTasksArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { capability, limit, offset } = parsed.data;

  try {
    const params = new URLSearchParams();
    if (capability) params.set("capability", capability);
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    const qs = params.toString();
    const result = await apiGet(`/market/tasks${qs ? `?${qs}` : ""}`);
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function claimTaskHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = claimTaskArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, claimerDid } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/claim`, { claimerDid });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function deliverResultHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deliverResultArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, claimerDid, resultBody, resultIpfs } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/deliver`, {
      claimerDid,
      resultBody,
      resultIpfs,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function preparePaymentHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = preparePaymentArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, posterDid } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/prepare-payment`, { posterDid });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function completeTaskHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = completeTaskArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, posterDid, txBytes, publicKey, signature, posterPrivateKey } = parsed.data;

  try {
    const payload: Record<string, unknown> = { posterDid };
    if (txBytes) payload.txBytes = txBytes;
    if (publicKey) payload.publicKey = publicKey;
    if (signature) payload.signature = signature;
    if (posterPrivateKey) payload.posterPrivateKey = posterPrivateKey;
    const result = await apiPost(`/market/tasks/${taskId}/complete`, payload);
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export function registerMarketplaceTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "post_task",
    "Post a new task to the marketplace. Requires valid poster passport. Returns taskId, txId (HCS transaction ID), and timestamp.",
    {
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
      title: z.string().min(1).max(200).describe("Task title"),
      description: z.string().min(1).max(4096).describe("Task description"),
      priceHbar: z.number().positive().describe("Price in HBAR"),
      capabilities: z.array(z.string()).min(1).describe("Required capabilities"),
      deadline: z.number().optional().describe("Deadline as unix timestamp"),
    },
    postTaskHandler,
  );

  r.registerTool(
    "list_tasks",
    "List available tasks from the marketplace with optional capability filter and pagination.",
    {
      capability: z.string().optional().describe("Filter by capability"),
      limit: z.number().optional().describe("Max tasks (default: 50)"),
      offset: z.number().optional().describe("Pagination offset (default: 0)"),
    },
    listTasksHandler,
  );

  r.registerTool(
    "claim_task",
    "Claim a task from the marketplace. Task must be in 'posted' status. Returns taskId, txId (HCS transaction ID), and timestamp.",
    {
      taskId: z.string().min(1).describe("Task ID to claim"),
      claimerDid: z.string().min(1).describe("Claimer DID"),
    },
    claimTaskHandler,
  );

  r.registerTool(
    "deliver_result",
    "Deliver task results. Task must be in 'claimed' status and caller must be the claimer. Returns taskId, txId (HCS transaction ID), and timestamp.",
    {
      taskId: z.string().min(1).describe("Task ID"),
      claimerDid: z.string().min(1).describe("Claimer DID"),
      resultBody: z.string().max(4096).optional().describe("Result content (max 4KB)"),
      resultIpfs: z.string().optional().describe("IPFS CID for large results"),
    },
    deliverResultHandler,
  );

  r.registerTool(
    "prepare_payment",
    "Prepare a frozen payment transaction for offline signing. Returns txBytes that the agent signs locally. Use before complete_task.",
    {
      taskId: z.string().min(1).describe("Task ID to prepare payment for"),
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
    },
    preparePaymentHandler,
  );

  r.registerTool(
    "complete_task",
    "Complete a task with P2P HBAR payment. Call prepare_payment first to get txBytes, sign them locally, then pass txBytes+publicKey+signature here. Task must be in 'delivered' status and caller must be the poster. Returns taskId, paymentTxId (HBAR transfer), and completedAt timestamp.",
    {
      taskId: z.string().min(1).describe("Task ID to complete"),
      posterDid: z.string().min(1).describe("Poster DID"),
      txBytes: z.string().optional().describe("Base64-encoded frozen transaction bytes from prepare_payment"),
      publicKey: z.string().optional().describe("Signer's public key (DER-encoded hex)"),
      signature: z.string().optional().describe("Base64-encoded signature of the transaction bytes"),
      posterPrivateKey: z.string().optional().describe("Poster's private key (legacy mode, not recommended)"),
    },
    completeTaskHandler,
  );
}
