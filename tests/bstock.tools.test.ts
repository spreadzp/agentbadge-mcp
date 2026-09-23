/**
 * SLICE-141-5: bstock.tools.ts — 5 read-only MCP tools over DeltaEngine.
 * Engine injected (structural interface); tools never do I/O.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NamespaceRegistry } from "../src/server";
import { registerBstockTools } from "../src/tools/bstock.tools";
import type { BstockEngineLike } from "../src/tools/bstock.tools";

function makeEngine(): BstockEngineLike {
  return {
    getDelta: (symbol: string) =>
      symbol === "AAPLB"
        ? {
            symbol: "AAPLB",
            underlying: "AAPL",
            multiplier: 1,
            bStockPrice: 182.5,
            underlyingPrice: 181.2,
            deltaPct: 0.7174,
            phase: "O",
            stale: false,
            inAlert: true,
            lastUpdateMs: 1_000_000,
          }
        : null,
    listDeltas: () => [
      {
        symbol: "AAPLB", underlying: "AAPL", multiplier: 1,
        bStockPrice: 182.5, underlyingPrice: 181.2,
        deltaPct: 0.7174, phase: "O", stale: false, inAlert: true,
        lastUpdateMs: 1_000_000, bookDepth: 5000,
      },
      {
        symbol: "NVDAB", underlying: "NVDA", multiplier: 1.00077822,
        bStockPrice: 951, underlyingPrice: 950,
        deltaPct: -1.2, phase: "POST", stale: false, inAlert: true,
        lastUpdateMs: 1_000_000, bookDepth: 9000,
      },
      {
        symbol: "TSLAB", underlying: "TSLA", multiplier: 1,
        bStockPrice: 250, underlyingPrice: 250.1,
        deltaPct: -0.04, phase: "O", stale: true, inAlert: false,
        lastUpdateMs: 900_000, bookDepth: 100,
      },
    ],
    getEvents: () => [
      { type: "tradingStatus", symbol: "AAPLB", status: "TRADING_HALTED", atMs: 1 },
      { type: "tradability", symbol: "NVDAB", value: "OFFMARKET", atMs: 2 },
    ],
    getHistory: (symbol: string) =>
      symbol === "AAPLB"
        ? [
            { t: 1, deltaPct: 0.3 },
            { t: 2, deltaPct: 0.9 },
            { t: 3, deltaPct: 0.7174 },
          ]
        : [],
  };
}

let ns: NamespaceRegistry;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await ns.handleHttpToolCall(name, args);
  return res;
}

function parse(res: { content: { type: string; text?: string }[] }) {
  return JSON.parse(res.content[0]!.text!);
}

beforeEach(() => {
  ns = new NamespaceRegistry("test-bstock");
  registerBstockTools(makeEngine(), ns);
});

describe("registration", () => {
  it("registers all 5 tools with JSON schemas", () => {
    const names = ns.listTools().map((t) => t.name).sort();
    expect(names).toEqual([
      "get_delta",
      "get_digest",
      "get_events",
      "get_quote",
      "list_deltas",
    ]);
    for (const t of ns.listTools()) {
      expect(t.inputSchema).toBeTruthy();
    }
  });
});

describe("get_delta", () => {
  it("returns delta% + phase + stale for a symbol", async () => {
    const res = await call("get_delta", { symbol: "AAPLB" });
    const data = parse(res);
    expect(data.deltaPct).toBeCloseTo(0.7174, 3);
    expect(data.phase).toBe("O");
    expect(data.stale).toBe(false);
    expect(data.underlying).toBe("AAPL");
  });

  it("returns error for unknown symbol", async () => {
    const res = await call("get_delta", { symbol: "XXXB" });
    expect(res.isError).toBe(true);
  });

  it("validation error without symbol", async () => {
    const res = await call("get_delta", {});
    expect(res.isError).toBe(true);
  });
});

describe("list_deltas", () => {
  it("returns all tickers sorted by |delta| desc", async () => {
    const res = await call("list_deltas");
    const data = parse(res);
    expect(data.map((d: { symbol: string }) => d.symbol)).toEqual([
      "NVDAB",
      "AAPLB",
      "TSLAB",
    ]);
  });

  it("minDeltaPct keeps only movers above the bound", async () => {
    const res = await call("list_deltas", { minDeltaPct: 1 });
    const data = parse(res);
    expect(data.map((d: { symbol: string }) => d.symbol)).toEqual(["NVDAB"]);
  });

  it("maxDeltaPct keeps only deltas within the bound", async () => {
    const res = await call("list_deltas", { maxDeltaPct: 1 });
    const data = parse(res);
    expect(data.map((d: { symbol: string }) => d.symbol)).toEqual([
      "AAPLB",
      "TSLAB",
    ]);
  });

  it("sort=liquidity orders by book depth desc", async () => {
    const res = await call("list_deltas", { sort: "liquidity" });
    const data = parse(res);
    expect(data.map((d: { symbol: string }) => d.symbol)).toEqual([
      "NVDAB",
      "AAPLB",
      "TSLAB",
    ]);
  });

  it("limit caps the result count", async () => {
    const res = await call("list_deltas", { limit: 2 });
    const data = parse(res);
    expect(data).toHaveLength(2);
  });
});

describe("get_quote", () => {
  it("returns bStock + underlying prices", async () => {
    const res = await call("get_quote", { symbol: "AAPLB" });
    const data = parse(res);
    expect(data.bStockPrice).toBe(182.5);
    expect(data.underlyingPrice).toBe(181.2);
    expect(data.multiplier).toBe(1);
  });

  it("error for unknown symbol", async () => {
    const res = await call("get_quote", { symbol: "XXXB" });
    expect(res.isError).toBe(true);
  });
});

describe("get_events", () => {
  it("returns recent events", async () => {
    const res = await call("get_events");
    const data = parse(res);
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe("tradingStatus");
  });
});

describe("get_digest", () => {
  it("returns per-symbol history summary", async () => {
    const res = await call("get_digest");
    const data = parse(res);
    const aapl = data.symbols.find(
      (s: { symbol: string }) => s.symbol === "AAPLB",
    );
    expect(aapl.points).toBe(3);
    expect(aapl.minDeltaPct).toBeCloseTo(0.3, 3);
    expect(aapl.maxDeltaPct).toBeCloseTo(0.9, 3);
    expect(aapl.lastDeltaPct).toBeCloseTo(0.7174, 3);
    expect(data.events).toBe(2);
  });
});
