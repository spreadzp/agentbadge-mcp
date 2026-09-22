/**
 * bstock.tools.ts — read-only MCP tools over DeltaEngine
 * (EPIC-141, SLICE-141-5). Pattern: marketplace.tools.ts.
 *
 * Engine is injected (BstockEngineLike structural interface) — tools
 * never do I/O, they read in-memory state. Wiring lives in the server
 * (SLICE-141-6+).
 *
 * Tools: get_delta, list_deltas, get_quote, get_events, get_digest.
 */

import { z } from "zod";
import { type NamespaceRegistry, getNamespace, type ToolResult } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

function notFound(symbol: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown symbol: ${symbol}` }],
  };
}

/** Read-only view of one tracked symbol (matches DeltaView shape). */
export interface BstockDeltaView {
  symbol: string;
  underlying: string;
  multiplier: number;
  bStockPrice: number | null;
  underlyingPrice: number | null;
  deltaPct: number | null;
  phase: string;
  stale: boolean;
  inAlert: boolean;
  lastUpdateMs: number;
}

export interface BstockEvent {
  type: string;
  symbol: string;
  status?: string;
  value?: string;
  msg?: string;
  atMs: number;
}

export interface BstockHistoryPoint {
  t: number;
  deltaPct: number;
}

/**
 * Structural interface for the injected engine — implemented by
 * DeltaEngine from @agentbadge/bstock-tracker. Kept structural so
 * packages/mcp has no dependency edge on the tracker package.
 */
export interface BstockEngineLike {
  getDelta(symbol: string): BstockDeltaView | null;
  listDeltas(): BstockDeltaView[];
  getEvents(): BstockEvent[];
  getHistory(symbol: string): BstockHistoryPoint[];
}

const symbolSchema = z
  .string()
  .min(1)
  .describe("bStock ticker (e.g. AAPLB)");

export function registerBstockTools(
  engine: BstockEngineLike,
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);

  r.registerTool(
    "get_delta",
    "Get current delta% between a Binance bStock and its underlying equity, with market phase and staleness flag.",
    { symbol: symbolSchema },
    async (args: Record<string, unknown>) => {
      const parsed = z.object({ symbol: symbolSchema }).safeParse(args);
      if (!parsed.success) return validationError(parsed.error.message);
      const d = engine.getDelta(parsed.data.symbol.toUpperCase());
      if (!d) return notFound(parsed.data.symbol);
      return ok(d);
    },
  );

  r.registerTool(
    "list_deltas",
    "List all tracked bStock tickers with delta%, sorted by |delta| descending.",
    {},
    async () => {
      const list = engine
        .listDeltas()
        .sort(
          (a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0),
        );
      return ok(list);
    },
  );

  r.registerTool(
    "get_quote",
    "Get bStock price and underlying equity price (+multiplier) for a symbol.",
    { symbol: symbolSchema },
    async (args: Record<string, unknown>) => {
      const parsed = z.object({ symbol: symbolSchema }).safeParse(args);
      if (!parsed.success) return validationError(parsed.error.message);
      const d = engine.getDelta(parsed.data.symbol.toUpperCase());
      if (!d) return notFound(parsed.data.symbol);
      return ok({
        symbol: d.symbol,
        underlying: d.underlying,
        bStockPrice: d.bStockPrice,
        underlyingPrice: d.underlyingPrice,
        multiplier: d.multiplier,
        phase: d.phase,
        stale: d.stale,
      });
    },
  );

  r.registerTool(
    "get_events",
    "Get recent market events: trading halts/resumes, tradability changes (NONE/OFFMARKET), calendar.",
    {},
    async () => ok(engine.getEvents()),
  );

  r.registerTool(
    "get_digest",
    "Get a digest summary: per-symbol delta stats over the rolling 24h window plus event count.",
    {},
    async () => {
      const symbols = engine.listDeltas().map((d) => {
        const history = engine.getHistory(d.symbol);
        const deltas = history.map((h) => h.deltaPct);
        return {
          symbol: d.symbol,
          underlying: d.underlying,
          phase: d.phase,
          stale: d.stale,
          deltaPct: d.deltaPct,
          points: history.length,
          minDeltaPct: deltas.length ? Math.min(...deltas) : null,
          maxDeltaPct: deltas.length ? Math.max(...deltas) : null,
          lastDeltaPct: deltas.length ? deltas[deltas.length - 1] : null,
        };
      });
      return ok({
        symbols,
        events: engine.getEvents().length,
      });
    },
  );
}
