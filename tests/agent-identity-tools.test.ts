import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  agentIdentityHandler,
  registerAgentIdentityTools,
  setAgentIdentityToolConfig,
} from "../src/tools/circle-payments.tools";

const ADDR = "0x" + "cd".repeat(20);

afterEach(() => {
  setAgentIdentityToolConfig(null);
});

describe("agent_identity tool", () => {
  it("flag off → isError", async () => {
    setAgentIdentityToolConfig(null);
    const res = await agentIdentityHandler({ address: ADDR });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("found → same payload as REST endpoint", async () => {
    const lookup = vi.fn().mockResolvedValue({
      passportTokenId: "42",
      readinessScore: 87,
      mintTx: "0xmint",
      chain: "hedera-testnet",
    });
    setAgentIdentityToolConfig({ lookup });
    const res = await agentIdentityHandler({ address: ADDR });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.address).toBe(ADDR);
    expect(data.passportTokenId).toBe("42");
    expect(data.readinessScore).toBe(87);
    expect(data.verifiedAt).toBeDefined();
    expect(lookup).toHaveBeenCalledWith(ADDR);
  });

  it("not found → {found:false} (not error)", async () => {
    setAgentIdentityToolConfig({ lookup: vi.fn().mockResolvedValue(undefined) });
    const res = await agentIdentityHandler({ address: ADDR });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.found).toBe(false);
    expect(data.address).toBe(ADDR);
  });

  it("malformed address → isError", async () => {
    setAgentIdentityToolConfig({ lookup: vi.fn() });
    const res = await agentIdentityHandler({ address: "not-an-address" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/invalid/i);
  });

  it("lookup throw → isError", async () => {
    setAgentIdentityToolConfig({
      lookup: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await agentIdentityHandler({ address: ADDR });
    expect(res.isError).toBe(true);
  });

  it("registerAgentIdentityTools → tool listed", () => {
    const ns = createNamespace("identity-test");
    registerAgentIdentityTools(ns);
    expect(ns.listTools().map((t) => t.name)).toContain("agent_identity");
  });
});
