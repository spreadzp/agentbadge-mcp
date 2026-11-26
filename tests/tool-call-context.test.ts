/**
 * SLICE-259-4: handler-level identity — ToolCallContext threading and
 * upgrade_tier ownership from verified DID context, not from args.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

const getPassportInfoMock = vi.fn();
const upgradeTierMock = vi.fn();
const didToAccountIdMock = vi.fn();

vi.mock("@agentbadge/passport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/passport")>();
  return {
    ...actual,
    getPassportInfo: (...a: unknown[]) => getPassportInfoMock(...a),
    upgradeTier: (...a: unknown[]) => upgradeTierMock(...a),
  };
});

vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    didToAccountId: (...a: unknown[]) => didToAccountIdMock(...a),
  };
});

import { NamespaceRegistry, type ToolCallContext } from "../src/server";
import { registerPassportTools } from "../src/tools/passport.tools";

const TOKEN = "0.0.777";
const SERIAL = 42;
const OWNER_ACCT = "0.0.555";
const OWNER_DID = `did:hcs:${TOKEN}:${SERIAL}`;
const OTHER_DID = "did:hcs:0.0.777:99";

function makeRegistry() {
  const ns = new NamespaceRegistry("test-ctx");
  registerPassportTools(ns);
  return ns;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPassportInfoMock.mockResolvedValue({ owner: OWNER_ACCT, active: true });
  upgradeTierMock.mockResolvedValue({ ok: true });
  didToAccountIdMock.mockResolvedValue(OWNER_ACCT);
});

describe("ToolCallContext threading (SLICE-259-4)", () => {
  it("forwards ctx to the handler via handleHttpToolCall", async () => {
    const ns = new NamespaceRegistry("ctx-pass");
    let seen: ToolCallContext | undefined;
    ns.registerTool("ctx_probe", "probe", {}, async (_args, ctx) => {
      seen = ctx;
      return { content: [{ type: "text", text: "ok" }] };
    }, { exposure: "public" });

    const ctx: ToolCallContext = {
      callerTier: "authenticated",
      verifiedDid: OWNER_DID,
      agentId: "eip155:1:0xabc:1",
    };
    await ns.handleHttpToolCall("ctx_probe", {}, ctx);
    expect(seen).toEqual(ctx);
  });

  it("keeps handlers working when ctx is omitted (backward compat)", async () => {
    const ns = new NamespaceRegistry("ctx-compat");
    ns.registerTool("no_ctx", "probe", {}, async () => ({
      content: [{ type: "text", text: "ok" }],
    }), { exposure: "public" });
    const res = await ns.handleHttpToolCall("no_ctx", {});
    expect(res.isError).toBeFalsy();
  });
});

describe("upgrade_tier — verified identity, not args (SLICE-259-4)", () => {
  const args = { tokenId: TOKEN, serial: SERIAL, newTier: "silver" };

  it("rejects submitting accountId in args (unlearn the field)", async () => {
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", {
      ...args,
      accountId: OWNER_ACCT,
    });
    expect(res.isError).toBe(true);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("denies call without verified identity (anon ctx)", async () => {
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "authenticated",
      agentId: "eip155:1:0xabc:1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/DID/i);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("denies non-owner: verified DID of a different passport", async () => {
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "authenticated",
      verifiedDid: OTHER_DID,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/does not match/i);
    expect(upgradeTierMock).not.toHaveBeenCalled();
    expect(didToAccountIdMock).not.toHaveBeenCalled();
  });

  it("owner: verified DID matching the passport resolves accountId from chain", async () => {
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "authenticated",
      verifiedDid: OWNER_DID,
    });
    expect(res.isError).toBeFalsy();
    expect(didToAccountIdMock).toHaveBeenCalledWith(OWNER_DID);
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });

  it("fails closed when owner DID does not resolve to an account", async () => {
    didToAccountIdMock.mockResolvedValue(null);
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "authenticated",
      verifiedDid: OWNER_DID,
    });
    expect(res.isError).toBe(true);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("admin: resolves owner from passport info, no DID needed", async () => {
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "admin",
    });
    expect(res.isError).toBeFalsy();
    expect(getPassportInfoMock).toHaveBeenCalledWith(TOKEN, SERIAL);
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });

  it("admin on missing passport fails before upgrade", async () => {
    getPassportInfoMock.mockResolvedValue(null);
    const ns = makeRegistry();
    const res = await ns.handleHttpToolCall("upgrade_tier", args, {
      callerTier: "admin",
    });
    expect(res.isError).toBe(true);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });
});
