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

// SLICE-259-7: anonymous callers see a CURATED discovery subset of
// the public tools — capability-first onboarding instead of the raw
// ~60-tool public registry. publicTier is metadata on the listing:
// "curated" marks a public tool for the anon projection; everything
// else defaults to "extended" (callable but unlisted for anon).

const MAX_ANON_TOOLS = 20;

describe("publicTier curation — SLICE-259-7", () => {
  const ns = createNamespace("cur-check");
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

  it("every listing carries a publicTier (curated|extended)", () => {
    for (const t of listing) {
      expect(["curated", "extended"]).toContain(t.publicTier);
    }
  });

  it("curated set is at most 20 tools", () => {
    const curated = listing.filter((t) => t.publicTier === "curated");
    // Server-side registrars add 5 more (search_knowledge,
    // get_knowledge_object, board_list, board_get, check_compliance)
    // — asserted in server-tool-exposure tests; keep package ≤15.
    expect(curated.length).toBeLessThanOrEqual(15);
    expect(curated.length).toBeGreaterThan(0);
  });

  it("every curated tool is exposure=public", () => {
    for (const t of listing) {
      if (t.publicTier === "curated") {
        expect(t.exposure, `${t.name} curated but not public`).toBe(
          "public",
        );
      }
    }
  });

  it("curated set is the documented starter subset", () => {
    const expected = new Set([
      "verify_passport",
      "get_passport",
      "list_passports",
      "get_tier_requirements",
      "get_audit_trail",
      "find_agents",
      "search_agents",
      "get_agent_card",
      "get_server_info",
      "get_ai_sitemap",
      "list_tasks",
      "supported_networks",
      "list_guides",
      "get_guide",
    ]);
    const curated = new Set(
      listing.filter((t) => t.publicTier === "curated").map((t) => t.name),
    );
    expect(curated).toEqual(expected);
  });

  it("non-curated public tools default to extended", () => {
    // list_corridors is public but not in the starter set
    expect(byName.get("list_corridors")?.publicTier).toBe("extended");
    // admin/auth tools are never curated
    expect(byName.get("revoke_passport")?.publicTier).toBe("extended");
    expect(byName.get("post_task")?.publicTier).toBe("extended");
  });

  it("registerTool marks publicTier through the options arg", () => {
    const probe = createNamespace("cur-probe");
    probe.registerTool(
      "cur_probe_tool",
      "probe",
      {},
      async () => ({ content: [{ type: "text", text: "ok" }] }),
      { exposure: "public", publicTier: "curated" },
    );
    expect(probe.listTools()[0].publicTier).toBe("curated");
  });
});
