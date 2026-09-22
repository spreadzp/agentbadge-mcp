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

const signTransactionArgsSchema = z.object({
  txBytes: z.string().min(1).describe("Base64-encoded frozen transaction bytes from prepare_payment"),
  privateKey: z.string().min(1).describe("Private key (DER-encoded hex or 0x-prefixed ECDSA hex)"),
});

export async function signTransactionHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = signTransactionArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(JSON.stringify(parsed.error.issues));

  const { txBytes, privateKey } = parsed.data;

  try {
    const result = await apiPost("/market/sign", { txBytes, privateKey });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function completeTaskWithKeyHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = completeTaskWithKeyArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(JSON.stringify(parsed.error.issues));

  const { taskId, posterDid, posterPrivateKey } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/complete-with-key`, {
      posterDid,
      posterPrivateKey,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

const completeTaskWithKeyArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to complete"),
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  posterPrivateKey: z.string().min(1).describe("Poster's private key (DER hex or 0x-prefixed ECDSA hex)"),
});

export async function postTaskWithKeyHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = postTaskWithKeyArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(JSON.stringify(parsed.error.issues));

  const { posterDid, title, description, priceHbar, capabilities, deadline, posterPrivateKey } = parsed.data;

  try {
    const result = await apiPost("/market/tasks/signed", {
      posterDid,
      title,
      description,
      priceHbar,
      capabilities,
      ...(deadline ? { deadline } : {}),
      posterPrivateKey,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

const postTaskWithKeyArgsSchema = z.object({
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  title: z.string().min(1).describe("Task title"),
  description: z.string().min(1).describe("Task description"),
  priceHbar: z.number().positive().describe("Price in HBAR (must be positive)"),
  capabilities: z.array(z.string().min(1)).min(1).describe("Required capabilities (non-empty array)"),
  deadline: z.number().optional().describe("Deadline as unix timestamp"),
  posterPrivateKey: z.string().min(1).describe("Poster's private key (DER hex or 0x-prefixed ECDSA hex)"),
});

export async function claimTaskWithKeyHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = claimTaskWithKeyArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(JSON.stringify(parsed.error.issues));

  const { taskId, claimerDid, claimerPrivateKey } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/claim-with-key`, {
      claimerDid,
      claimerPrivateKey,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

const claimTaskWithKeyArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to claim"),
  claimerDid: z.string().min(1).describe("Claimer DID (did:hcs:tokenId:serial)"),
  claimerPrivateKey: z.string().min(1).describe("Claimer's private key (DER hex or 0x-prefixed ECDSA hex)"),
});

export async function deliverResultWithKeyHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deliverResultWithKeyArgsSchema.safeParse(args);
  if (!parsed.success) return validationError(JSON.stringify(parsed.error.issues));

  const { taskId, claimerDid, resultBody, resultIpfs, claimerPrivateKey } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/deliver-with-key`, {
      claimerDid,
      ...(resultBody ? { resultBody } : {}),
      ...(resultIpfs ? { resultIpfs } : {}),
      claimerPrivateKey,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

const deliverResultWithKeyArgsSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to deliver results for"),
  claimerDid: z.string().min(1).describe("Claimer DID (did:hcs:tokenId:serial)"),
  resultBody: z.string().optional().describe("Result content (max 4KB). Use resultIpfs for larger results."),
  resultIpfs: z.string().optional().describe("IPFS CID for large results"),
  claimerPrivateKey: z.string().min(1).describe("Claimer's private key (DER hex or 0x-prefixed ECDSA hex)"),
});

export function registerSigningTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "sign_transaction",
    "Sign frozen Hedera transaction bytes with a private key. Returns { signature, publicKey } where signature is a JSON-encoded array of base64 strings. Pure local operation — no network calls. Use after prepare_payment to sign the payment transaction.",
    {
      txBytes: z.string().min(1).describe("Base64-encoded frozen transaction bytes from prepare_payment"),
      privateKey: z.string().min(1).describe("Private key (DER-encoded hex like 302e... or 0x-prefixed ECDSA hex)"),
    },
    signTransactionHandler,
  );

  r.registerTool(
    "complete_task_with_key",
    "Complete a task with a single call using poster's private key. Internally: prepare_payment → sign → submit to Hedera → complete task. Returns { taskId, paymentTxId, completedAt }. Task must be in 'delivered' status. Convenience tool — eliminates 3-step round-trip.",
    {
      taskId: z.string().min(1).describe("Task ID to complete"),
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
      posterPrivateKey: z.string().min(1).describe("Poster's private key (DER hex or 0x-prefixed ECDSA hex)"),
    },
    completeTaskWithKeyHandler,
  );

  r.registerTool(
    "post_task_with_key",
    "Post a task to the marketplace with agent-signed HCS message. Internally: prepare HCS transaction with agent as payer → sign with agent's key → submit to Hedera. Returns { txId, taskId, timestamp }. HCS transaction ID uses agent's account, proving authorship.",
    {
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
      title: z.string().min(1).describe("Task title"),
      description: z.string().min(1).describe("Task description"),
      priceHbar: z.number().positive().describe("Price in HBAR (must be positive)"),
      capabilities: z.array(z.string().min(1)).min(1).describe("Required capabilities (non-empty array)"),
      deadline: z.number().optional().describe("Deadline as unix timestamp"),
      posterPrivateKey: z.string().min(1).describe("Poster's private key (DER hex or 0x-prefixed ECDSA hex)"),
    },
    postTaskWithKeyHandler,
  );

  r.registerTool(
    "claim_task_with_key",
    "Claim a task with agent-signed HCS message. Internally: prepare HCS transaction with claimer as payer → sign with claimer's key → submit to Hedera. Returns { taskId, txId, timestamp }. HCS transaction ID uses claimer's account, proving claim authorship. Task must be in 'posted' status.",
    {
      taskId: z.string().min(1).describe("Task ID to claim"),
      claimerDid: z.string().min(1).describe("Claimer DID (did:hcs:tokenId:serial)"),
      claimerPrivateKey: z.string().min(1).describe("Claimer's private key (DER hex or 0x-prefixed ECDSA hex)"),
    },
    claimTaskWithKeyHandler,
  );

  r.registerTool(
    "deliver_result_with_key",
    "Deliver task results with agent-signed HCS message. Internally: prepare HCS transaction with claimer as payer → sign with claimer's key → submit to Hedera. Returns { taskId, txId, timestamp }. Task must be in 'claimed' status and caller must be the claimer. Provide either resultBody (max 4KB) or resultIpfs.",
    {
      taskId: z.string().min(1).describe("Task ID to deliver results for"),
      claimerDid: z.string().min(1).describe("Claimer DID (did:hcs:tokenId:serial)"),
      resultBody: z.string().optional().describe("Result content (max 4KB). Use resultIpfs for larger results."),
      resultIpfs: z.string().optional().describe("IPFS CID for large results"),
      claimerPrivateKey: z.string().min(1).describe("Claimer's private key (DER hex or 0x-prefixed ECDSA hex)"),
    },
    deliverResultWithKeyHandler,
  );
}
