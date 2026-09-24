import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace } from "../src/server";
import {
  circleWalletBalanceHandler,
  registerCircleWalletBalanceTools,
  setCircleWalletBalanceToolConfig,
} from "../src/tools/circle-payments.tools";

afterEach(() => {
  setCircleWalletBalanceToolConfig(null);
});

describe("circle_wallet_balance tool", () => {
  it("flag off → isError", async () => {
    setCircleWalletBalanceToolConfig(null);
    const res = await circleWalletBalanceHandler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled|not enabled/i);
  });

  it("returns per-chain balances", async () => {
    const balanceLookup = vi.fn().mockResolvedValue([
      {
        network: "eip155:84532",
        chain: "Base Sepolia",
        wallet: { balance: "1234567", formatted: "1.234567" },
        gateway: { available: "5.5", withdrawing: "0", withdrawable: "0" },
      },
      {
        network: "eip155:5042002",
        chain: "Arc Testnet",
        wallet: { balance: "42", formatted: "0.000042" },
      },
    ]);
    setCircleWalletBalanceToolConfig({ balanceLookup });
    const res = await circleWalletBalanceHandler({});
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].wallet.formatted).toBe("1.234567");
    expect(data[0].gateway.available).toBe("5.5");
    expect(balanceLookup).toHaveBeenCalledWith(undefined);
  });

  it("chain filter passed through", async () => {
    const balanceLookup = vi.fn().mockResolvedValue([]);
    setCircleWalletBalanceToolConfig({ balanceLookup });
    await circleWalletBalanceHandler({ chain: "eip155:5042002" });
    expect(balanceLookup).toHaveBeenCalledWith("eip155:5042002");
  });

  it("lookup throw → isError", async () => {
    setCircleWalletBalanceToolConfig({
      balanceLookup: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const res = await circleWalletBalanceHandler({});
    expect(res.isError).toBe(true);
  });

  it("registerCircleWalletBalanceTools → tool listed", () => {
    const ns = createNamespace("balance-test");
    registerCircleWalletBalanceTools(ns);
    expect(ns.listTools().map((t) => t.name)).toContain(
      "circle_wallet_balance",
    );
  });
});
