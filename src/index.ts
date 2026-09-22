// MCP server
export {
  mcpServer,
  registerTool,
  listTools,
  handleHttpToolCall,
  handleHttpRequest,
  resetHttpTransport,
  startStdio,
  createNamespace,
  getNamespace,
  listAllNamespaces,
  NamespaceRegistry,
  type ToolResult,
  type ToolHandler,
  type ToolListing,
} from "./server";

// Tool registration functions
export { registerPassportTools } from "./tools/passport.tools";
export { registerAuditCatalogTools, getAuditTrail } from "./tools/audit-catalog.tools";
export { registerDirectoryTools, registerAgent, findAgents } from "./tools/directory.tools";
export {
  registerA2ATools,
  sendMessageHandler,
  getInboxHandler,
  getConversationHandler,
} from "./tools/a2a.tools";
export {
  registerMarketplaceTools,
  postTaskHandler,
  listTasksHandler,
  claimTaskHandler,
  deliverResultHandler,
  preparePaymentHandler,
  completeTaskHandler,
} from "./tools/marketplace.tools";
export {
  registerGuideTools,
  getGuideHandler,
  listGuidesHandler,
} from "./tools/guide.tools";
export {
  registerSigningTools,
  signTransactionHandler,
  completeTaskWithKeyHandler,
  postTaskWithKeyHandler,
  claimTaskWithKeyHandler,
  deliverResultWithKeyHandler,
} from "./tools/signing.tools";
export {
  registerEscrowTools,
  getEscrowStatusHandler,
  cancelEscrowHandler,
  increaseRewardHandler,
  verifyResultHandler,
} from "./tools/escrow.tools";
export {
  registerDiscoveryTools,
  getAgentCardHandler,
  searchAgentsHandler,
  getServerInfoHandler,
  getAiSitemapHandler,
} from "./tools/discovery.tools";
export {
  registerDatasetTools,
  downloadDatasetHandler,
  uploadResultHandler,
} from "./tools/dataset.tools";
// bStock tools need an injected DeltaEngine — registered by the server
// wiring layer, not via registerAllTools (EPIC-141, SLICE-141-5).
export {
  registerBstockTools,
  type BstockEngineLike,
  type BstockDeltaView,
  type BstockEvent,
  type BstockHistoryPoint,
} from "./tools/bstock.tools";

// Convenience: register all package tools into a namespace (or global if no ns)
import { registerPassportTools } from "./tools/passport.tools";
import { registerAuditCatalogTools } from "./tools/audit-catalog.tools";
import { registerDirectoryTools } from "./tools/directory.tools";
import { registerA2ATools } from "./tools/a2a.tools";
import { registerMarketplaceTools } from "./tools/marketplace.tools";
import { registerSigningTools } from "./tools/signing.tools";
import { registerEscrowTools } from "./tools/escrow.tools";
import { registerGuideTools } from "./tools/guide.tools";
import { registerDiscoveryTools } from "./tools/discovery.tools";
import { registerDatasetTools } from "./tools/dataset.tools";
import type { NamespaceRegistry } from "./server";

export function registerAllTools(ns?: NamespaceRegistry): void {
  registerPassportTools(ns);
  registerSigningTools(ns);
  registerEscrowTools(ns);
  registerMarketplaceTools(ns);
  registerDatasetTools(ns);
  registerDiscoveryTools(ns);
  registerDirectoryTools(ns);
  registerGuideTools(ns);
  registerA2ATools(ns);
  registerAuditCatalogTools(ns);
}
