import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  circlePayHandler,
  registerCirclePayTools,
  setCirclePayToolConfig,
} from "../src/tools/circle-payments.tools";

const SELLER = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const URL = "http://localhost:4021/api/identity/0xabc";

const ACCEPTS = [
  {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
  },
  {
    scheme: "eip3009-client-broadcast",
    network: "eip155:5042002",
    amount: "1000",
    asset: "0x3600000000000000000000000000000000000000",
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    extra: { assetTransferMethod: "transferWithAuthorization" },
  },
];

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function paymentRequiredHeader(accepts = ACCEPTS) {
  return b64({
    x402Version: 2,
    resource: { url: URL, description: "Paid", mimeType: "application/json" },
    accepts,
  });
}

function mock402() {
  return {
    status: 402,
    ok: false,
    headers: {
      get: (k: string) =>
        k === "PAYMENT-REQUIRED" ? paymentRequiredHeader() : null,
    },
    json: async () => ({}),
  } as unknown as Response;
}

const mockRouter = {
  verify: vi.fn(),
  settle: vi.fn(),
  accepts: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setCirclePayToolConfig(null);
  vi.unstubAllGlobals();
});

describe("circle_pay tool", () => {
  it("flag off → isError", async () => {
    setCirclePayToolConfig(null);
    const res = await circlePayHandler({ url: URL });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("requirements mode → returns accepts from 402", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mock402()));
    const res = await circlePayHandler({ url: URL });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.x402Version).toBe(2);
    expect(data.accepts).toHaveLength(2);
    expect(data.accepts[0].payTo).toBe(SELLER);
  });

  it("scheme filter → only matching accepts", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mock402()));
    const res = await circlePayHandler({
      url: URL,
      scheme: "eip3009-client-broadcast",
    });
    const data = JSON.parse(res.content[0].text);
    expect(data.accepts).toHaveLength(1);
    expect(data.accepts[0].scheme).toBe("eip3009-client-broadcast");
  });

  it("network filter → only matching accepts", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mock402()));
    const res = await circlePayHandler({ url: URL, network: "eip155:84532" });
    const data = JSON.parse(res.content[0].text);
    expect(data.accepts).toHaveLength(1);
    expect(data.accepts[0].network).toBe("eip155:84532");
  });

  it("verify mode → router.verify with matched requirement", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mock402()));
    mockRouter.verify.mockResolvedValue({ isValid: true, payer: PAYER });
    const payment = b64({
      x402Version: 2,
      accepted: ACCEPTS[0],
      payload: { signature: "0xsig" },
    });
    const res = await circlePayHandler({ url: URL, payment });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.isValid).toBe(true);
    expect(data.payer).toBe(PAYER);
    expect(mockRouter.verify).toHaveBeenCalledOnce();
  });

  it("verify mode → payload not matching any accepts → isError", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mock402()));
    const payment = b64({
      x402Version: 2,
      accepted: { scheme: "unknown", network: "eip155:1" },
      payload: {},
    });
    const res = await circlePayHandler({ url: URL, payment });
    expect(res.isError).toBe(true);
    expect(mockRouter.verify).not.toHaveBeenCalled();
  });

  it("non-402 URL → isError", async () => {
    setCirclePayToolConfig({ router: mockRouter as never });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true } as Response),
    );
    const res = await circlePayHandler({ url: URL });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not payment-gated|402/i);
  });

  it("registerCirclePayTools → tool listed in namespace", () => {
    const ns = createNamespace("circle-test");
    registerCirclePayTools(ns);
    const tools = ns.listTools();
    expect(tools.map((t) => t.name)).toContain("circle_pay");
  });
});
