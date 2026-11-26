import { describe, it, expect } from "vitest";
import { createNamespace } from "../src/server";
import { registerAllTools } from "../src/index";
import {
  registerCirclePayTools,
  registerCircleWalletBalanceTools,
  registerPaymentStatusTools,
  registerPaymentHistoryTools,
  registerSupportedNetworksTools,
  registerAgentIdentityTools,
} from "../src/tools/circle-payments.tools";
import { registerBstockTools } from "../src/tools/bstock.tools";
import { registerFxDeltaTools } from "../src/tools/fxdelta.tools";

// SLICE-259-6: private-key-bearing tools must never be reachable by
// anonymous or ordinary agb_ callers, and no public tool may carry a
// key-shaped input. The REST side already gates *-with-key endpoints
// via keyEndpointGate (EPIC-83); this pins the same policy on the
// MCP surface so a future registration can't reopen the seam.

// Params that hand the server a private signing key — the trust
// boundary violation itself. Caller-owned service credentials
// (Pinata API secret) are a different, acceptable class.
const PRIVATE_KEY_PARAM = /private.?key|operator.?key/i;

// Any param that looks like a secret — used for the public-tier scan
// where even service credentials must not appear.
const SECRET_PARAM = /private.?key|operator.?key|secret|mnemonic|seed.?phrase/i;

// Tools whose entire purpose is key submission — mirrors the REST
// keyEndpointGate semantics: operator/demo only (ALLOW_KEY_ENDPOINTS).
const KEY_FAMILY_TOOLS = new Set([
  "sign_transaction",
  "post_task_with_key",
  "claim_task_with_key",
  "deliver_result_with_key",
  "complete_task_with_key",
  "send_message_with_key",
]);

// Documented exceptions: private-key params tolerated on non-admin
// tools, each with a rationale recorded in tool-exposure-map.md.
// - complete_task.posterPrivateKey: escrow release currently REQUIRES
//   the poster key (scheduled-tx release); signature flow is forbidden
//   there by contract. Removing it breaks escrow completion via MCP —
//   redesign tracked as follow-up.
const DOCUMENTED_KEY_EXCEPTIONS: ReadonlyMap<string, Set<string>> = new Map([
  ["complete_task", new Set(["posterPrivateKey"])],
]);

function schemaParamNames(tool: { inputSchema: unknown }): string[] {
  const schema = tool.inputSchema as
    | { properties?: Record<string, unknown> }
    | undefined;
  return Object.keys(schema?.properties ?? {});
}

describe("key-tools policy — SLICE-259-6", () => {
  const ns = createNamespace("key-policy");
  registerAllTools(ns);
  registerCirclePayTools(ns);
  registerCircleWalletBalanceTools(ns);
  registerPaymentStatusTools(ns);
  registerPaymentHistoryTools(ns);
  registerSupportedNetworksTools(ns);
  registerAgentIdentityTools(ns);
  registerBstockTools(undefined as never, ns);
  registerFxDeltaTools(undefined as never, ns);

  const listing = ns.listTools();
  const byName = new Map(listing.map((t) => [t.name, t]));

  it("no PUBLIC tool accepts any secret-shaped parameter", () => {
    const violations: string[] = [];
    for (const t of listing) {
      if (t.exposure !== "public") continue;
      for (const param of schemaParamNames(t)) {
        if (SECRET_PARAM.test(param)) {
          violations.push(`${t.name}.${param}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("every key-family tool is admin-only", () => {
    for (const name of KEY_FAMILY_TOOLS) {
      const tool = byName.get(name);
      expect(tool, `${name} must be registered`).toBeDefined();
      expect(tool!.exposure, `${name} must be admin`).toBe("admin");
    }
  });

  it("private-key params appear only on admin tools or documented exceptions", () => {
    const violations: string[] = [];
    for (const t of listing) {
      const exceptions = DOCUMENTED_KEY_EXCEPTIONS.get(t.name);
      for (const param of schemaParamNames(t)) {
        if (!PRIVATE_KEY_PARAM.test(param)) continue;
        if (t.exposure === "admin") continue;
        if (exceptions?.has(param)) continue;
        violations.push(`${t.name}.${param} (exposure=${t.exposure})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("every documented exception actually exists in its schema", () => {
    for (const [toolName, params] of DOCUMENTED_KEY_EXCEPTIONS) {
      const tool = byName.get(toolName);
      expect(tool, `${toolName} must be registered`).toBeDefined();
      for (const p of params) {
        expect(
          schemaParamNames(tool!),
          `${toolName}.${p} must exist`,
        ).toContain(p);
      }
    }
  });
});
