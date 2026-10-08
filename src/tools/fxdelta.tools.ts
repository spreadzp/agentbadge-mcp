/**
 * fxdelta.tools.ts — read-only MCP tools over the Celo FX DeltaEngine
 * (EPIC-191, SLICE-191-7, D-191-13). Direct port of bstock.tools.ts
 * with corridor semantics: onchain stablecoin rate vs offchain FX ref.
 *
 * Engine is injected (FxDeltaEngineLike structural interface) — tools
 * never do I/O, they read in-memory state. Wiring lives in the server.
 *
 * Tools: get_delta, list_corridors, get_quote, get_events, get_digest.
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

function notFound(corridor: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown corridor: ${corridor}` }],
  };
}

/** Read-only view of one FX corridor (matches FxDeltaView shape). */
export interface FxDeltaView {
  corridor: string;
  fiat: string;
  chainRate: number | null;
  fxRefRate: number | null;
  deltaPct: number | null;
  phase: string;
  frozen: boolean;
  stale: boolean;
  thin: boolean;
  inAlert: boolean;
  oracleLagPct: number | null;
  tvlUsd: number;
  lastUpdateMs: number;
}

export interface FxDeltaEvent {
  type: string;
  corridor: string;
  msg?: string;
  atMs: number;
}

export interface FxDeltaHistoryPoint {
  t: number;
  deltaPct: number;
}

/**
 * Structural interface for the injected engine — implemented by
 * DeltaEngine from fxdelta-tracker. Kept structural so packages/mcp
 * has no dependency edge on the tracker package.
 */
export interface FxDeltaEngineLike {
  getView(corridor: string): FxDeltaView | null;
  getAll(): FxDeltaView[];
  getDigest(): FxDeltaView[];
  getEvents(): FxDeltaEvent[];
  getHistory(corridor: string): FxDeltaHistoryPoint[];
}

const corridorSchema = z
  .string()
  .min(1)
  .describe("FX corridor symbol (e.g. USDT-NGN, USDT-BRL)");

export function registerFxDeltaTools(
  engine: FxDeltaEngineLike,
  ns?: NamespaceRegistry,
): void {
  const r = getRegistry(ns);

  r.registerTool(
    "get_delta",
    "Get current delta% between the onchain Celo stablecoin rate and the offchain FX reference for a corridor, with market phase, frozen and staleness flags.",
    { corridor: corridorSchema },
    async (args: Record<string, unknown>) => {
      const parsed = z.object({ corridor: corridorSchema }).safeParse(args);
      if (!parsed.success) return validationError(parsed.error.message);
      const d = engine.getView(parsed.data.corridor.toUpperCase());
      if (!d) return notFound(parsed.data.corridor);
      return ok(d);
    },
  );

  r.registerTool(
    "list_corridors",
    "List tracked FX corridors with delta%. Optional filters: " +
      "minDeltaPct/maxDeltaPct bound |delta%|, sort=delta|liquidity " +
      "(liquidity = pool TVL desc, surfaces deep corridors), " +
      "limit caps the list. Thin corridors are included but flagged.",
    {
      minDeltaPct: z
        .number()
        .optional()
        .describe("Only |deltaPct| >= this (e.g. 1 = movers over 1%)"),
      maxDeltaPct: z
        .number()
        .optional()
        .describe("Only |deltaPct| <= this (e.g. 5 = within 5%)"),
      sort: z
        .enum(["delta", "liquidity"])
        .optional()
        .describe("delta=|delta%| desc (default); liquidity=TVL desc"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Return at most N rows"),
    },
    async (args: Record<string, unknown>) => {
      const parsed = z
        .object({
          minDeltaPct: z.number().optional(),
          maxDeltaPct: z.number().optional(),
          sort: z.enum(["delta", "liquidity"]).optional(),
          limit: z.number().int().positive().optional(),
        })
        .safeParse(args);
      if (!parsed.success) return validationError(parsed.error.message);
      const { minDeltaPct, maxDeltaPct, sort, limit } = parsed.data;

      let list = engine.getAll();
      if (minDeltaPct !== undefined) {
        list = list.filter(
          (d) => d.deltaPct !== null && Math.abs(d.deltaPct) >= minDeltaPct,
        );
      }
      if (maxDeltaPct !== undefined) {
        list = list.filter(
          (d) => d.deltaPct !== null && Math.abs(d.deltaPct) <= maxDeltaPct,
        );
      }
      if (sort === "liquidity") {
        list = [...list].sort((a, b) => b.tvlUsd - a.tvlUsd);
      } else {
        list = [...list].sort(
          (a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0),
        );
      }
      if (limit !== undefined) list = list.slice(0, limit);
      return ok(list);
    },
  );

  r.registerTool(
    "get_quote",
    "Get onchain rate and offchain FX reference rate for a corridor.",
    { corridor: corridorSchema },
    async (args: Record<string, unknown>) => {
      const parsed = z.object({ corridor: corridorSchema }).safeParse(args);
      if (!parsed.success) return validationError(parsed.error.message);
      const d = engine.getView(parsed.data.corridor.toUpperCase());
      if (!d) return notFound(parsed.data.corridor);
      return ok({
        corridor: d.corridor,
        fiat: d.fiat,
        chainRate: d.chainRate,
        fxRefRate: d.fxRefRate,
        oracleLagPct: d.oracleLagPct,
        phase: d.phase,
        frozen: d.frozen,
        stale: d.stale,
        thin: d.thin,
      });
    },
  );

  r.registerTool(
    "get_events",
    "Get recent corridor events: alert crossings, source outages, thin-liquidity suppressions.",
    {},
    async () => ok(engine.getEvents()),
  );

  r.registerTool(
    "get_digest",
    "Get a digest summary: per-corridor delta stats over the rolling 24h window plus event count.",
    {},
    async () => {
      const corridors = engine.getAll().map((d) => {
        const history = engine.getHistory(d.corridor);
        const deltas = history.map((h) => h.deltaPct);
        return {
          corridor: d.corridor,
          fiat: d.fiat,
          phase: d.phase,
          frozen: d.frozen,
          stale: d.stale,
          thin: d.thin,
          deltaPct: d.deltaPct,
          points: history.length,
          minDeltaPct: deltas.length ? Math.min(...deltas) : null,
          maxDeltaPct: deltas.length ? Math.max(...deltas) : null,
          lastDeltaPct: deltas.length ? deltas[deltas.length - 1] : null,
        };
      });
      return ok({
        corridors,
        events: engine.getEvents().length,
      });
    },
  );
}
