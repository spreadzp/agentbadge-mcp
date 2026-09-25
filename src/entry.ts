#!/usr/bin/env node
import {
  startStdio,
  createNamespace,
  getNamespace,
  registerAllTools,
  type NamespaceRegistry,
} from "./index.js";
import { logger } from "@agentbadge/passport";

const namespace = process.env.MCP_NAMESPACE ?? process.argv[2] ?? "all";

let ns: NamespaceRegistry;

if (namespace === "all") {
  registerAllTools();
  ns = getNamespace("all")!;
} else {
  ns = createNamespace(namespace);
  registerAllTools(ns);
}

ns.startStdio().catch((e) => {
  logger.error("Failed to start MCP stdio server", {
    error: e instanceof Error ? e : new Error(String(e)),
  });
  process.exit(1);
});
