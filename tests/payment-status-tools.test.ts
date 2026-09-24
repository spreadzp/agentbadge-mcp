import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  paymentStatusHandler,
  registerPaymentStatusTools,
  setPaymentStatusToolConfig,
} from "../src/tools/circle-payments.tools";

const TX_HASH = "0x" + "ab".repeat(32);

afterEach(() => {
  setPaymentStatusToolConfig(null);
});

describe("payment_status tool", () => {
  it("flag off → isError", async () => {
    setPaymentStatusToolConfig(null);
    const res = await paymentStatusHandler({ ref: TX_HASH });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("delegates to statusLookup and returns normalized status", async () => {
    const statusLookup = vi.fn().mockResolvedValue({
      status: "confirmed",
      ref: TX_HASH,
      refType: "tx-hash",
      scheme: "eip3009-client-broadcast",
      network: "eip155:5042002",
    });
    setPaymentStatusToolConfig({ statusLookup });
    const res = await paymentStatusHandler({ ref: TX_HASH });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data.status).toBe("confirmed");
    expect(data.scheme).toBe("eip3009-client-broadcast");
    expect(statusLookup).toHaveBeenCalledWith(TX_HASH);
  });

  it("not_found propagates", async () => {
    setPaymentStatusToolConfig({
      statusLookup: vi
        .fn()
        .mockResolvedValue({ status: "not_found", ref: "x", refType: "internal" }),
    });
    const res = await paymentStatusHandler({ ref: "x" });
    const data = JSON.parse(res.content[0].text);
    expect(data.status).toBe("not_found");
  });

  it("lookup throw → isError", async () => {
    setPaymentStatusToolConfig({
      statusLookup: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await paymentStatusHandler({ ref: "x" });
    expect(res.isError).toBe(true);
  });

  it("missing ref → isError", async () => {
    setPaymentStatusToolConfig({ statusLookup: vi.fn() });
    const res = await paymentStatusHandler({});
    expect(res.isError).toBe(true);
  });

  it("registerPaymentStatusTools → tool listed", () => {
    const ns = createNamespace("status-test");
    registerPaymentStatusTools(ns);
    expect(ns.listTools().map((t) => t.name)).toContain("payment_status");
  });
});
