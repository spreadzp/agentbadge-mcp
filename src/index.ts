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
// Telegram subscription tools — injected subscription store (141-10).
export {
  registerBstockTelegramTools,
  type BstockTelegramToolDeps,
  type TelegramSubscriptionStore,
} from "./tools/bstock-telegram.tools";
// FX-delta tools — injected DeltaEngine + subscription store,
// registered by the server wiring layer (EPIC-191, SLICE-191-7).
export {
  registerFxDeltaTools,
  type FxDeltaEngineLike,
  type FxDeltaView,
  type FxDeltaEvent,
  type FxDeltaHistoryPoint,
} from "./tools/fxdelta.tools";
export {
  registerFxDeltaTelegramTools,
  type FxDeltaTelegramToolDeps,
} from "./tools/fxdelta-telegram.tools";
// Circle/Arc payment tools — injected config via setXxxToolConfig,
// registered by the server wiring layer (all + market namespaces),
// NOT via registerAllTools (EPIC-150, D4). Flag-gated by
// CIRCLE_PAYMENTS_ENABLED on the server.
export {
  registerCirclePayTools,
  setCirclePayToolConfig,
  circlePayHandler,
  type CirclePayToolConfig,
  registerCircleWalletBalanceTools,
  setCircleWalletBalanceToolConfig,
  circleWalletBalanceHandler,
  type CircleWalletBalanceToolConfig,
  registerPaymentStatusTools,
  setPaymentStatusToolConfig,
  paymentStatusHandler,
  type PaymentStatusToolConfig,
  registerPaymentHistoryTools,
  setPaymentHistoryToolConfig,
  paymentHistoryHandler,
  type PaymentHistoryToolConfig,
  registerSupportedNetworksTools,
  setSupportedNetworksToolConfig,
  supportedNetworksHandler,
  type SupportedNetworksToolConfig,
  type CircleCapabilityFlags,
  registerAgentIdentityTools,
  setAgentIdentityToolConfig,
  agentIdentityHandler,
  type AgentIdentityToolConfig,
  type IdentityLookupResult,
} from "./tools/circle-payments.tools";

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
