import { describe, it, expect } from "vitest";
import { createNamespace, type ToolExposure } from "../src/server";
import { registerAllTools } from "../src/index";
import { registerCirclePayTools } from "../src/tools/circle-payments.tools";
import { registerCircleWalletBalanceTools } from "../src/tools/circle-payments.tools";
import { registerPaymentStatusTools } from "../src/tools/circle-payments.tools";
import { registerPaymentHistoryTools } from "../src/tools/circle-payments.tools";
import { registerSupportedNetworksTools } from "../src/tools/circle-payments.tools";
import { registerAgentIdentityTools } from "../src/tools/circle-payments.tools";
import { registerBstockTools } from "../src/tools/bstock.tools";
import { registerFxDeltaTools } from "../src/tools/fxdelta.tools";

const EXPECTED_ADMIN = new Set([
  "revoke_passport",
  // SLICE-259-4: upgrade_tier moved admin → authenticated — the owner
  // path is a verified DID matching the passport; admin still reaches
  // it via tier ordering. Handler-level ownership check inside.
  "circle_wallet_balance",
  "payment_history",
  "sign_transaction",
  "send_message",
  "send_message_with_key",
  "post_task_with_key",
  "claim_task_with_key",
  "deliver_result_with_key",
  "complete_task_with_key",
]);

const EXPECTED_AUTHENTICATED = new Set([
  "request_passport",
  "upload_image",
  "upgrade_tier",
  "upload_result",
  "register_agent",
  "post_task",
  "claim_task",
  "deliver_result",
  "complete_task",
  "prepare_payment",
  "cancel_escrow",
  "increase_reward",
  "verify_result",
  // subscribe_telegram / unsubscribe_telegram / get_subscription_status are
  // also authenticated but register only via server wiring (deps-required) —
  // covered by tool-exposure-map.md
  "get_inbox",
  "get_conversation",
  "circle_pay",
  "payment_status",
]);

describe("tool exposure classification — packages/mcp (SLICE-259-2)", () => {
  const ns = createNamespace("cls-check");
  registerAllTools(ns);
  registerCirclePayTools(ns);
  registerCircleWalletBalanceTools(ns);
  registerPaymentStatusTools(ns);
  registerPaymentHistoryTools(ns);
  registerSupportedNetworksTools(ns);
  registerAgentIdentityTools(ns);
  // engine deps are only captured into handler closures — safe to pass
  // undefined for a registration/exposure check
  registerBstockTools(undefined as never, ns);
  registerFxDeltaTools(undefined as never, ns);

  const listing = ns.listTools();
  const byName = new Map(listing.map((t) => [t.name, t.exposure]));

  it("every registered tool has an explicit exposure tier", () => {
    for (const t of listing) {
      expect(["public", "authenticated", "admin"]).toContain(t.exposure);
    }
  });

  it("admin tools match the exposure map (destructive/ops/key-input)", () => {
    for (const name of EXPECTED_ADMIN) {
      expect(byName.get(name), `${name} must be admin`).toBe("admin");
    }
  });

  it("authenticated tools match the exposure map (agent-identity actions)", () => {
    for (const name of EXPECTED_AUTHENTICATED) {
      expect(byName.get(name), `${name} must be authenticated`).toBe(
        "authenticated",
      );
    }
  });

  it("read-only discover tools are public", () => {
    const publicSet = new Set(
      listing.filter((t) => t.exposure === "public").map((t) => t.name),
    );
    for (const name of [
      "verify_passport",
      "get_passport",
      "list_passports",
      "get_audit_trail",
      "get_tier_requirements",
      "find_agents",
      "get_agent_card",
      "search_agents",
      "get_server_info",
      "get_ai_sitemap",
      "download_dataset",
      "list_tasks",
      "get_escrow_status",
      "get_guide",
      "list_guides",
      "supported_networks",
      "agent_identity",
      "get_delta",
      "list_deltas",
      "list_corridors",
      "get_quote",
      "get_events",
      "get_digest",
    ]) {
      expect(publicSet.has(name), `${name} must be public`).toBe(true);
    }
  });

  it("no tool defaults to admin silently (count sanity)", () => {
    const tiers: Record<ToolExposure, number> = {
      public: 0,
      authenticated: 0,
      admin: 0,
    };
    for (const t of listing) tiers[t.exposure]++;
    expect(tiers.admin).toBe(EXPECTED_ADMIN.size);
    expect(tiers.public).toBeGreaterThan(0);
  });
});
