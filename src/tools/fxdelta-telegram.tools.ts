/**
 * FX-delta Telegram subscription tools (EPIC-191, SLICE-191-7, D-191-13).
 * Direct port of bstock-telegram.tools.ts — same DM model (Q30): agents
 * subscribe a Telegram username via MCP; the server binds
 * agent-token → username → chat_id.
 *
 * Caller identity arrives as `args._agentId` — injected by the
 * mcp-namespace route from the bearer-auth middleware.
 */

import { z } from "zod";
import type { NamespaceRegistry } from "../server.js";
import type { TelegramSubscriptionStore } from "./bstock-telegram.tools";

export interface FxDeltaTelegramToolDeps {
  subscriptions: TelegramSubscriptionStore;
}

/** Injected by the mcp-namespace route from bearer auth — must be a
 * declared schema key or zod strips it during args parsing. */
const agentIdField = {
  _agentId: z.string().optional().describe("injected caller agent id"),
};

function agentIdOf(args: Record<string, unknown>): string | null {
  const id = args._agentId;
  return typeof id === "string" && id ? id : null;
}

function text(t: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text: t }] };
}

export function registerFxDeltaTelegramTools(
  deps: FxDeltaTelegramToolDeps,
  r: NamespaceRegistry,
): void {
  const { subscriptions } = deps;

  r.registerTool(
    "subscribe_telegram",
    "Subscribe a Telegram username to Celo FX delta alerts. The user must have written /start to the bot first (DM model).",
    {
      username: z
        .string()
        .describe("Telegram username (with or without @)"),
      ...agentIdField,
    },
    async (args) => {
      const agentId = agentIdOf(args);
      if (!agentId) return text("unauthenticated", true);
      const username = String(args.username ?? "").trim();
      if (!username) return text("username required", true);
      const sub = subscriptions.subscribe(agentId, username);
      if (!sub) {
        return text(
          `Unknown Telegram user "${username}" — write /start to the bot first, then retry subscribe_telegram.`,
          true,
        );
      }
      return text(
        `Subscribed: @${sub.username} (chat ${sub.chatId}) will receive FX delta alerts.`,
      );
    },
  );

  r.registerTool(
    "unsubscribe_telegram",
    "Unsubscribe the calling agent's FX delta Telegram alerts.",
    { ...agentIdField },
    async (args) => {
      const agentId = agentIdOf(args);
      if (!agentId) return text("unauthenticated", true);
      const removed = subscriptions.unsubscribe(agentId);
      return text(
        removed ? "Unsubscribed from FX delta alerts." : "not subscribed",
      );
    },
  );

  r.registerTool(
    "get_subscription_status",
    "Show the calling agent's FX delta Telegram subscription status.",
    { ...agentIdField },
    async (args) => {
      const agentId = agentIdOf(args);
      if (!agentId) return text("unauthenticated", true);
      const sub = subscriptions.status(agentId);
      if (!sub) return text("not subscribed");
      return text(`subscribed: @${sub.username} (chat ${sub.chatId})`);
    },
  );
}
