/**
 * SLICE-191-7: fxdelta.tools.ts — 5 read-only MCP tools over the
 * Celo FX DeltaEngine. Ported from bstock.tools.test.ts (AC1).
 * Engine injected (structural interface); tools never do I/O.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NamespaceRegistry } from "../src/server";
import { registerFxDeltaTools } from "../src/tools/fxdelta.tools";
import type { FxDeltaEngineLike } from "../src/tools/fxdelta.tools";

function makeEngine(): FxDeltaEngineLike {
  const corridors = [
    {
      corridor: "USDT-NGN", fiat: "NGN",
      chainRate: 1520.5, fxRefRate: 1510.2,
      deltaPct: 0.682, phase: "open", frozen: false, stale: false,
      thin: false, inAlert: true, oracleLagPct: 0.03,
      tvlUsd: 197110, lastUpdateMs: 1_000_000,
    },
    {
      corridor: "USDT-BRL", fiat: "BRL",
      chainRate: 5.45, fxRefRate: 5.51,
      deltaPct: -1.089, phase: "open", frozen: false, stale: false,
      thin: false, inAlert: true, oracleLagPct: null,
      tvlUsd: 45702, lastUpdateMs: 1_000_000,
    },
    {
      corridor: "USDT-KES", fiat: "KES",
      chainRate: 129.0, fxRefRate: 129.1,
      deltaPct: -0.077, phase: "closed", frozen: true, stale: true,
      thin: true, inAlert: false, oracleLagPct: null,
      tvlUsd: 1300, lastUpdateMs: 900_000,
    },
  ];
  return {
    getView: (corridor: string) =>
      corridors.find((c) => c.corridor === corridor) ?? null,
    getAll: () => corridors,
    getDigest: () =>
      corridors.filter((c) => !c.thin && c.deltaPct !== null),
    getEvents: () => [
      { type: "alert", corridor: "USDT-NGN", msg: "crossed 0.5%", atMs: 1 },
      { type: "source", corridor: "USDT-BRL", msg: "uniswap stale", atMs: 2 },
    ],
    getHistory: (corridor: string) =>
      corridor === "USDT-NGN"
        ? [
            { t: 1, deltaPct: 0.2 },
            { t: 2, deltaPct: 0.9 },
            { t: 3, deltaPct: 0.682 },
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
  ns = new NamespaceRegistry("test-fxdelta");
  registerFxDeltaTools(makeEngine(), ns);
});

describe("registration", () => {
  it("registers all 5 tools with JSON schemas", () => {
    const names = ns.listTools().map((t) => t.name).sort();
    expect(names).toEqual([
      "get_delta",
      "get_digest",
      "get_events",
      "get_quote",
      "list_corridors",
    ]);
    for (const t of ns.listTools()) {
      expect(t.inputSchema).toBeTruthy();
    }
  });
});

describe("get_delta", () => {
  it("returns delta% + phase + frozen + stale for a corridor", async () => {
    const res = await call("get_delta", { corridor: "USDT-NGN" });
    const data = parse(res);
    expect(data.deltaPct).toBeCloseTo(0.682, 3);
    expect(data.phase).toBe("open");
    expect(data.frozen).toBe(false);
    expect(data.stale).toBe(false);
    expect(data.fiat).toBe("NGN");
    expect(data.oracleLagPct).toBeCloseTo(0.03, 3);
  });

  it("returns error for unknown corridor", async () => {
    const res = await call("get_delta", { corridor: "USDT-XXX" });
    expect(res.isError).toBe(true);
  });

  it("validation error without corridor", async () => {
    const res = await call("get_delta", {});
    expect(res.isError).toBe(true);
  });
});

describe("list_corridors", () => {
  it("returns all corridors sorted by |delta| desc", async () => {
    const res = await call("list_corridors");
    const data = parse(res);
    expect(data.map((d: { corridor: string }) => d.corridor)).toEqual([
      "USDT-BRL",
      "USDT-NGN",
      "USDT-KES",
    ]);
  });

  it("minDeltaPct keeps only movers above the bound", async () => {
    const res = await call("list_corridors", { minDeltaPct: 1 });
    const data = parse(res);
    expect(data.map((d: { corridor: string }) => d.corridor)).toEqual([
      "USDT-BRL",
    ]);
  });

  it("maxDeltaPct keeps only deltas within the bound", async () => {
    const res = await call("list_corridors", { maxDeltaPct: 1 });
    const data = parse(res);
    expect(data.map((d: { corridor: string }) => d.corridor)).toEqual([
      "USDT-NGN",
      "USDT-KES",
    ]);
  });

  it("sort=liquidity orders by pool TVL desc", async () => {
    const res = await call("list_corridors", { sort: "liquidity" });
    const data = parse(res);
    expect(data.map((d: { corridor: string }) => d.corridor)).toEqual([
      "USDT-NGN",
      "USDT-BRL",
      "USDT-KES",
    ]);
  });

  it("limit caps the result count", async () => {
    const res = await call("list_corridors", { limit: 2 });
    const data = parse(res);
    expect(data).toHaveLength(2);
  });
});

describe("get_quote", () => {
  it("returns onchain + FX ref rates", async () => {
    const res = await call("get_quote", { corridor: "USDT-NGN" });
    const data = parse(res);
    expect(data.chainRate).toBe(1520.5);
    expect(data.fxRefRate).toBe(1510.2);
    expect(data.frozen).toBe(false);
    expect(data.thin).toBe(false);
  });

  it("error for unknown corridor", async () => {
    const res = await call("get_quote", { corridor: "USDT-XXX" });
    expect(res.isError).toBe(true);
  });
});

describe("get_events", () => {
  it("returns recent events", async () => {
    const res = await call("get_events");
    const data = parse(res);
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe("alert");
    expect(data[0].corridor).toBe("USDT-NGN");
  });
});

describe("get_digest", () => {
  it("returns per-corridor history summary", async () => {
    const res = await call("get_digest");
    const data = parse(res);
    const ngn = data.corridors.find(
      (s: { corridor: string }) => s.corridor === "USDT-NGN",
    );
    expect(ngn.points).toBe(3);
    expect(ngn.minDeltaPct).toBeCloseTo(0.2, 3);
    expect(ngn.maxDeltaPct).toBeCloseTo(0.9, 3);
    expect(ngn.lastDeltaPct).toBeCloseTo(0.682, 3);
    expect(data.events).toBe(2);
  });
});
