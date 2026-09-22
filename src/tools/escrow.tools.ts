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

// ─── Schemas ─────────────────────────────────────────────────────

const getEscrowStatusSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to check escrow status for"),
});

const cancelEscrowSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to cancel"),
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
});

const increaseRewardSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to increase reward for"),
  posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
  newPriceHbar: z.number().positive().describe("New reward amount in HBAR (must be greater than current)"),
});

const verifyResultSchema = z.object({
  taskId: z.string().min(1).describe("Task ID to run verification on"),
});

// ─── Handlers ────────────────────────────────────────────────────

export async function getEscrowStatusHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getEscrowStatusSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId } = parsed.data;

  try {
    const result = await apiGet(`/market/tasks/${taskId}/escrow-status`);
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function cancelEscrowHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = cancelEscrowSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, posterDid } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/cancel`, { posterDid });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function increaseRewardHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = increaseRewardSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId, posterDid, newPriceHbar } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/increase-reward`, {
      posterDid,
      newPriceHbar,
    });
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

export async function verifyResultHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = verifyResultSchema.safeParse(args);
  if (!parsed.success) return validationError(parsed.error.message);

  const { taskId } = parsed.data;

  try {
    const result = await apiPost(`/market/tasks/${taskId}/verify`, {});
    return ok(result);
  } catch (err) {
    return serviceErrorToMcpError(err);
  }
}

// ─── Registration ────────────────────────────────────────────────

export function registerEscrowTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "get_escrow_status",
    "Get escrow status for a marketplace task. Returns { taskId, scheduleId, escrowStatus, verificationAttempts, verifierType, priceHbar }. Useful for checking if an escrow is pending, signed, or cancelled.",
    {
      taskId: z.string().min(1).describe("Task ID to check escrow status for"),
    },
    getEscrowStatusHandler,
  );

  r.registerTool(
    "cancel_escrow",
    "Cancel a marketplace task and return escrow HBAR to the poster. Task must be in posted, claimed, or delivered status. If a scheduled transaction (escrow) exists, it is deleted. Returns { taskId, cancelledAt, hbarReturned }.",
    {
      taskId: z.string().min(1).describe("Task ID to cancel"),
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
    },
    cancelEscrowHandler,
  );

  r.registerTool(
    "increase_reward",
    "Increase the reward for a marketplace task. Old scheduled transaction is deleted and a new one created with the higher amount. Task must be in posted or claimed status. Returns { taskId, newScheduleId, newPriceHbar, hcsTxId }.",
    {
      taskId: z.string().min(1).describe("Task ID to increase reward for"),
      posterDid: z.string().min(1).describe("Poster DID (did:hcs:tokenId:serial)"),
      newPriceHbar: z.number().positive().describe("New reward amount in HBAR (must be greater than current)"),
    },
    increaseRewardHandler,
  );

  r.registerTool(
    "verify_result",
    "Run verification on a task without completing it. Triggers the verifier and returns the result. Task must be in delivered or claimed status. Returns { taskId, passed, attempts, shouldReturnToMarket, report }.",
    {
      taskId: z.string().min(1).describe("Task ID to run verification on"),
    },
    verifyResultHandler,
  );
}
