/**
 * circle-payments.tools.ts — Circle/Arc MCP tools (EPIC-150, SLICE-150-1).
 * Moved from hackathon/server/src/mcp/*.ts — zero behavior change.
 *
 * All tools are flag-gated: handlers return isError until the server
 * wiring injects config via setXxxToolConfig (CIRCLE_PAYMENTS_ENABLED).
 * Registered by the server wiring layer into `all` + `market`
 * namespaces — NOT via registerAllTools (D4), so stdio users never
 * see them.
 *
 * Imports from @agentbadge/circle-payments are type-only (devDep, D2) —
 * erased at compile time, stdio users don't pull viem/@x402/@circle-fin.
 *
 * Tools: circle_pay, circle_wallet_balance, payment_status,
 * payment_history, supported_networks, agent_identity.
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "../server";
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentRouter,
  BalanceLookup,
  PaymentStatusLookup,
  PaymentHistory,
} from "@agentbadge/circle-payments";

/**
 * TODO(SLICE-150-2): moved to @agentbadge/circle-payments
 * (src/identity.ts, next to the identity extension). Local copy until
 * then — keep in sync with server routes/identity.ts.
 */
export interface IdentityLookupResult {
  passportTokenId: string;
  readinessScore?: number;
  mintTx?: string;
  issuedAt?: string;
  chain?: string;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

function b64decode<T>(s: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf-8")) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// circle_pay — inbound payment helper (SLICE-129-15, D5).
// Requirements mode: {url} → fetch, decode 402 PAYMENT-REQUIRED, return
// accepts[] (optionally filtered). Verify mode: {url, payment} → decode
// base64 payment-signature, match against accepts, run router.verify.
// Inbound only — never executes outbound payments, never settles.
// ---------------------------------------------------------------------------

export interface CirclePayToolConfig {
  /** Router from the circle payments runtime (verify path) */
  router: PaymentRouter;
  /** Injectable fetch (tests) */
  fetchFn?: typeof fetch;
}

let circlePayConfig: CirclePayToolConfig | null = null;

export function setCirclePayToolConfig(
  cfg: CirclePayToolConfig | null,
): void {
  circlePayConfig = cfg;
}

interface PaymentRequiredBody {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export async function circlePayHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!circlePayConfig) {
    return err(
      "circle_pay is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const url = args.url as string;
  const scheme = args.scheme as string | undefined;
  const network = args.network as string | undefined;
  const payment = args.payment as string | undefined;

  const fetchFn = circlePayConfig.fetchFn ?? fetch;
  let resp: Response;
  try {
    resp = await fetchFn(url);
  } catch (e) {
    return err(`Failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
  }
  if (resp.status !== 402) {
    return err(
      `URL is not payment-gated (HTTP ${resp.status}) — no payment required`,
    );
  }
  const header = resp.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return err("402 response missing PAYMENT-REQUIRED header");
  }
  const body = b64decode<PaymentRequiredBody>(header);
  if (!body?.accepts?.length) {
    return err("PAYMENT-REQUIRED header has no accepts[]");
  }

  const accepts = body.accepts.filter(
    (a) =>
      (!scheme || a.scheme === scheme) && (!network || a.network === network),
  );

  // Mode A — requirements only
  if (!payment) {
    return ok({
      x402Version: body.x402Version,
      resource: body.resource,
      accepts,
      ...(body.extensions ? { extensions: body.extensions } : {}),
    });
  }

  // Mode B — verify submitted payload
  const payload = b64decode<PaymentPayload>(payment);
  if (!payload?.accepted) {
    return err("Invalid payment payload — expected base64 JSON with `accepted`");
  }
  const accepted = payload.accepted;
  const requirement = accepts.find(
    (a) =>
      a.scheme === accepted.scheme &&
      a.network === accepted.network &&
      a.asset === accepted.asset,
  );
  if (!requirement) {
    return err(
      `Payment payload accepted scheme/network/asset does not match any advertised accepts (got ${accepted.scheme} on ${accepted.network})`,
    );
  }
  try {
    const result = await circlePayConfig.router.verify(payload, requirement);
    return ok(result);
  } catch (e) {
    return err(
      `Verification failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerCirclePayTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "circle_pay",
    "Circle nanopayments helper (inbound only). Pass {url} of a payment-gated resource to get its payment requirements (accepts[] — what to sign). Optionally filter by scheme/network. Pass {url, payment} with a base64 payment-signature payload to verify it against the resource requirements before submitting. Never executes outbound payments or settles.",
    {
      url: z
        .string()
        .describe("URL of the payment-gated resource (must return HTTP 402)"),
      scheme: z
        .string()
        .optional()
        .describe(
          "Filter accepts by scheme: exact | gateway | eip3009-client-broadcast",
        ),
      network: z
        .string()
        .optional()
        .describe("Filter accepts by CAIP-2 network (e.g. eip155:84532)"),
      payment: z
        .string()
        .optional()
        .describe(
          "Base64-encoded payment-signature payload to verify against the resource requirements",
        ),
    },
    circlePayHandler,
  );
}

// ---------------------------------------------------------------------------
// circle_wallet_balance — OPS/INTERNAL (SLICE-129-18).
// Seller wallet USDC + Gateway balances per chain. Read-only.
// ---------------------------------------------------------------------------

export interface CircleWalletBalanceToolConfig {
  balanceLookup: BalanceLookup;
}

let circleWalletBalanceConfig: CircleWalletBalanceToolConfig | null = null;

export function setCircleWalletBalanceToolConfig(
  cfg: CircleWalletBalanceToolConfig | null,
): void {
  circleWalletBalanceConfig = cfg;
}

export async function circleWalletBalanceHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!circleWalletBalanceConfig) {
    return err(
      "circle_wallet_balance is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const chain = args.chain as string | undefined;
  try {
    const balances = await circleWalletBalanceConfig.balanceLookup(chain);
    return ok(balances);
  } catch (e) {
    return err(
      `Balance lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerCircleWalletBalanceTools(
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);
  r.registerTool(
    "circle_wallet_balance",
    "[OPS/INTERNAL] Get this server's seller wallet balances — on-chain USDC (balanceOf) plus Circle Gateway balance per enabled chain. Optional chain filter (CAIP-2 like eip155:84532 or name like 'Arc Testnet'). Returns [{network, chain, wallet:{balance,formatted}, gateway?}]. Read-only ops tool — not for buyer agents.",
    {
      chain: z
        .string()
        .optional()
        .describe(
          "Filter to one chain: CAIP-2 id (eip155:84532) or name (Base Sepolia, Arc Testnet). Omit for all enabled chains.",
        ),
    },
    circleWalletBalanceHandler,
  );
}

// ---------------------------------------------------------------------------
// payment_status — normalized status by any ref (SLICE-129-16).
// Gateway transfer UUID, on-chain tx hash, or internal ledger id.
// ---------------------------------------------------------------------------

export interface PaymentStatusToolConfig {
  statusLookup: PaymentStatusLookup;
}

let paymentStatusConfig: PaymentStatusToolConfig | null = null;

export function setPaymentStatusToolConfig(
  cfg: PaymentStatusToolConfig | null,
): void {
  paymentStatusConfig = cfg;
}

export async function paymentStatusHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!paymentStatusConfig) {
    return err(
      "payment_status is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const ref = args.ref as string | undefined;
  if (!ref) {
    return err(
      "Missing required argument: ref (gateway transfer UUID, tx hash, or internal payment id)",
    );
  }
  try {
    const status = await paymentStatusConfig.statusLookup(ref);
    return ok(status);
  } catch (e) {
    return err(
      `Status lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerPaymentStatusTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "payment_status",
    "Get normalized payment status for any Circle nanopayments rail. Pass a ref: gateway transfer UUID (Gateway rail), 0x tx hash (Arc self-settle / on-chain), or internal payment id (ledger). Returns {status: pending|confirmed|completed|failed|not_found, scheme, network, amount, confirmedAt}. Read-only.",
    {
      ref: z
        .string()
        .describe(
          "Payment reference: gateway transfer UUID, 0x transaction hash, or internal payment id",
        ),
    },
    paymentStatusHandler,
  );
}

// ---------------------------------------------------------------------------
// payment_history — OPS/INTERNAL (SLICE-129-20).
// Recent settled payments + failure ledger entries, sorted desc.
// ---------------------------------------------------------------------------

export interface PaymentHistoryToolConfig {
  paymentHistory: PaymentHistory;
}

let paymentHistoryConfig: PaymentHistoryToolConfig | null = null;

export function setPaymentHistoryToolConfig(
  cfg: PaymentHistoryToolConfig | null,
): void {
  paymentHistoryConfig = cfg;
}

const HISTORY_STATUS_VALUES = new Set(["settled", "failed"]);

export async function paymentHistoryHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!paymentHistoryConfig) {
    return err(
      "payment_history is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const status = args.status as string | undefined;
  if (status !== undefined && !HISTORY_STATUS_VALUES.has(status)) {
    return err(`Invalid status "${status}" — expected "settled" or "failed"`);
  }
  const limit =
    typeof args.limit === "number" && args.limit > 0
      ? Math.floor(args.limit)
      : undefined;
  try {
    const entries = await paymentHistoryConfig.paymentHistory({
      limit,
      status: status as "settled" | "failed" | undefined,
    });
    return ok(entries);
  } catch (e) {
    return err(
      `History lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerPaymentHistoryTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "payment_history",
    "[OPS/INTERNAL] Recent payment history for this server — settled gateway transfers merged with failure ledger entries (with reasons), sorted newest first. Optional status filter (settled|failed) and limit. Read-only ops tool.",
    {
      status: z
        .enum(["settled", "failed"])
        .optional()
        .describe("Filter by entry type; omit for all"),
      limit: z
        .number()
        .optional()
        .describe("Max entries to return (default 20)"),
    },
    paymentHistoryHandler,
  );
}

// ---------------------------------------------------------------------------
// supported_networks — capability matrix (SLICE-129-19).
// Router accepts[] for a reference price + live per-flag state.
// ---------------------------------------------------------------------------

/** Reference price for the accepts matrix — $0.001 in 6-dec base units. */
const REFERENCE_AMOUNT = "1000";

export interface CircleCapabilityFlags {
  gateway: boolean;
  arc: boolean;
  identity: boolean;
  escrow: boolean;
}

export interface SupportedNetworksToolConfig {
  router: PaymentRouter;
  /** Live flag reader — called per invocation (no restart needed) */
  getFlags: () => CircleCapabilityFlags;
}

let supportedNetworksConfig: SupportedNetworksToolConfig | null = null;

export function setSupportedNetworksToolConfig(
  cfg: SupportedNetworksToolConfig | null,
): void {
  supportedNetworksConfig = cfg;
}

export async function supportedNetworksHandler(
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!supportedNetworksConfig) {
    return err(
      "supported_networks is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  try {
    const accepts = supportedNetworksConfig.router.acceptsFor(REFERENCE_AMOUNT);
    const capabilities = supportedNetworksConfig.getFlags();
    return ok({ referenceAmount: REFERENCE_AMOUNT, accepts, capabilities });
  } catch (e) {
    return err(
      `Capability lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerSupportedNetworksTools(
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);
  r.registerTool(
    "supported_networks",
    "Get the Circle nanopayments capability matrix: accepts[] payment requirements (schemes, networks, assets, payTo) for a $0.001 reference price, plus per-flag capability state (gateway, arc, identity, escrow). Reflects live flag state. Read-only.",
    {},
    supportedNetworksHandler,
  );
}

// ---------------------------------------------------------------------------
// agent_identity — passport data by EVM address (SLICE-129-17).
// Same `lookup` as GET /api/identity/:address — identical payload shape.
// ---------------------------------------------------------------------------

export interface AgentIdentityToolConfig {
  lookup: (address: string) => Promise<IdentityLookupResult | undefined>;
}

let agentIdentityConfig: AgentIdentityToolConfig | null = null;

export function setAgentIdentityToolConfig(
  cfg: AgentIdentityToolConfig | null,
): void {
  agentIdentityConfig = cfg;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function agentIdentityHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!agentIdentityConfig) {
    return err(
      "agent_identity is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const address = args.address as string | undefined;
  if (!address || !EVM_ADDRESS.test(address)) {
    return err("Invalid or missing address — expected 0x + 40 hex chars");
  }
  try {
    const passport = await agentIdentityConfig.lookup(address);
    if (!passport) {
      return ok({ found: false, address });
    }
    return ok({
      address,
      ...passport,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    return err(
      `Identity lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerAgentIdentityTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "agent_identity",
    "Get AgentBadge passport identity for an EVM address — passportTokenId, readinessScore, mintTx, issuedAt, chain. Same payload as GET /api/identity/:address. Returns {found:false} when no passport exists.",
    {
      address: z
        .string()
        .describe("EVM address to look up (0x + 40 hex chars)"),
    },
    agentIdentityHandler,
  );
}
