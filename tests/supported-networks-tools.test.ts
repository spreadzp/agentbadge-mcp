import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  supportedNetworksHandler,
  registerSupportedNetworksTools,
  setSupportedNetworksToolConfig,
} from "../src/tools/circle-payments.tools";

const ACCEPTS = [
  {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0xUSDC",
    amount: "1000",
    payTo: "0xseller",
  },
  {
    scheme: "eip3009-client-broadcast",
    network: "eip155:5042002",
    asset: "0xUSDC",
    amount: "1000",
    payTo: "0xseller",
  },
];

afterEach(() => {
  setSupportedNetworksToolConfig(null);
});

describe("supported_networks tool", () => {
  it("flag off → isError", async () => {
    setSupportedNetworksToolConfig(null);
    const res = await supportedNetworksHandler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("returns accepts matrix + capabilities", async () => {
    const router = { acceptsFor: vi.fn().mockReturnValue(ACCEPTS) };
    setSupportedNetworksToolConfig({
      router: router as never,
      getFlags: () => ({
        gateway: true,
        arc: true,
        identity: true,
        escrow: false,
      }),
    });
    const res = await supportedNetworksHandler({});
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.accepts).toHaveLength(2);
    expect(data.accepts[0].scheme).toBe("exact");
    expect(data.capabilities.gateway).toBe(true);
    expect(data.capabilities.arc).toBe(true);
    expect(data.capabilities.identity).toBe(true);
    expect(data.capabilities.escrow).toBe(false);
    expect(data.referenceAmount).toBe("1000");
  });

  it("live flag state — getFlags called per invocation", async () => {
    let arcOn = false;
    const router = { acceptsFor: vi.fn().mockReturnValue(ACCEPTS) };
    setSupportedNetworksToolConfig({
      router: router as never,
      getFlags: () => ({
        gateway: true,
        arc: arcOn,
        identity: false,
        escrow: false,
      }),
    });
    const r1 = JSON.parse(
      (await supportedNetworksHandler({})).content[0].text,
    );
    expect(r1.capabilities.arc).toBe(false);
    arcOn = true;
    const r2 = JSON.parse(
      (await supportedNetworksHandler({})).content[0].text,
    );
    expect(r2.capabilities.arc).toBe(true);
  });

  it("acceptsFor throw → isError", async () => {
    setSupportedNetworksToolConfig({
      router: {
        acceptsFor: vi.fn().mockImplementation(() => {
          throw new Error("boom");
        }),
      } as never,
      getFlags: () => ({
        gateway: false,
        arc: false,
        identity: false,
        escrow: false,
      }),
    });
    const res = await supportedNetworksHandler({});
    expect(res.isError).toBe(true);
  });

  it("registerSupportedNetworksTools → tool listed", () => {
    const ns = createNamespace("networks-test");
    registerSupportedNetworksTools(ns);
    expect(ns.listTools().map((t) => t.name)).toContain(
      "supported_networks",
    );
  });
});
