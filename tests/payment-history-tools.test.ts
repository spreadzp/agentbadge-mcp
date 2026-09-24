import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  paymentHistoryHandler,
  registerPaymentHistoryTools,
  setPaymentHistoryToolConfig,
} from "../src/tools/circle-payments.tools";

afterEach(() => {
  setPaymentHistoryToolConfig(null);
});

describe("payment_history tool", () => {
  it("flag off → isError", async () => {
    setPaymentHistoryToolConfig(null);
    const res = await paymentHistoryHandler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("returns merged entries", async () => {
    const paymentHistory = vi.fn().mockResolvedValue([
      {
        type: "failed",
        scheme: "exact",
        network: "eip155:84532",
        amount: "500",
        reason: "fulfillment crashed",
        at: "2026-09-18T02:00:00Z",
      },
      {
        type: "settled",
        scheme: "gateway",
        network: "eip155:84532",
        amount: "1000",
        payer: "0xpayer",
        ref: "tx-1",
        at: "2026-09-18T01:00:00Z",
      },
    ]);
    setPaymentHistoryToolConfig({ paymentHistory });
    const res = await paymentHistoryHandler({});
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe("failed");
    expect(data[1].type).toBe("settled");
  });

  it("limit + status passed through", async () => {
    const paymentHistory = vi.fn().mockResolvedValue([]);
    setPaymentHistoryToolConfig({ paymentHistory });
    await paymentHistoryHandler({ limit: 5, status: "failed" });
    expect(paymentHistory).toHaveBeenCalledWith({
      limit: 5,
      status: "failed",
    });
  });

  it("invalid status → isError", async () => {
    setPaymentHistoryToolConfig({ paymentHistory: vi.fn() });
    const res = await paymentHistoryHandler({ status: "bogus" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/status/i);
  });

  it("lookup throw → isError", async () => {
    setPaymentHistoryToolConfig({
      paymentHistory: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await paymentHistoryHandler({});
    expect(res.isError).toBe(true);
  });

  it("registerPaymentHistoryTools → tool listed", () => {
    const ns = createNamespace("history-test");
    registerPaymentHistoryTools(ns);
    expect(ns.listTools().map((t) => t.name)).toContain("payment_history");
  });
});
