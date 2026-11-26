/**
 * Passport MCP tools — 6 tools covering the full passport lifecycle.
 *
 * Reference: SLICE-3-2, hackathon-flow.md:89-99 (§5)
 *
 * All tools delegate to the same service functions as the REST routes,
 * not duplicated logic.
 */

import { z } from "zod";
import { type NamespaceRegistry, getNamespace, type ToolResult } from "../server";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}
import {
  issuePassport,
  getPassportInfo,
  listAllPassports,
  upgradeTier,
  revokePassport,
  uploadImage,
} from "@agentbadge/passport";
import {
  type Capability,
  didToAccountId,
  extractTokenAndSerial,
} from "@agentbadge/hedera-core";

/** Convert a service error to an MCP error response. */
function serviceErrorToMcpError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** Wrap a JSON-serializable result as an MCP text response. */
function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

const tierSchema = z.enum(["bronze", "silver", "gold", "platinum"]);

/** Input schema for request_passport. */
const requestPassportSchema = {
  accountId: z.string().min(1).describe("Hedera account ID of the agent"),
  signature: z.string().min(1).describe("Wallet signature proving account ownership"),
  tier: tierSchema.describe("Passport tier (bronze, silver, gold, platinum)"),
  name: z.string().min(1).describe("Agent display name"),
  capabilities: z.array(z.string()).min(1).describe("Agent capabilities"),
  endpoint: z.string().optional().describe("Agent profile page URL. If omitted, auto-generated as {baseUrl}/ui/agents/{accountId}"),
  skills: z.array(z.string()).optional().describe("Agent skills (e.g. code_review, social_media, data_analysis)"),
  imageUrl: z.string().optional().describe("Agent avatar/landing image URL (IPFS URI or HTTP URL). If omitted, a tier-based placeholder is used. Example: ipfs://bafy.../avatar.png"),
};

/** Input schema for upload_image. */
const uploadImageSchema = {
  base64Data: z.string().min(1).describe("Base64-encoded image data (without data: prefix)"),
  filename: z.string().min(1).describe("Original filename including extension (e.g. avatar.png)"),
  mimeType: z.string().min(1).describe("MIME type of the image (e.g. image/png, image/jpeg)"),
};

/** Input schema for verify_passport and get_passport. */
const passportIdSchema = {
  tokenId: z.string().min(1).describe("HTS passport token ID"),
  serial: z.number().int().positive().describe("NFT serial number"),
};

/** Input schema for upgrade_tier. */
const upgradeTierSchema = {
  tokenId: z.string().min(1).describe("HTS passport token ID"),
  serial: z.number().int().positive().describe("NFT serial number"),
  newTier: tierSchema.describe("New tier to upgrade to"),
  // EPIC-259 (SLICE-259-4): identity comes from the verified DID context,
  // never from arguments — submitting accountId is a hard error so agents
  // unlearn the old (spoofable) field.
  accountId: z
    .never()
    .optional()
    .describe("REMOVED — do not send. Caller identity is taken from the verified DID signature context."),
};

/** Input schema for revoke_passport. */
const revokePassportSchema = {
  tokenId: z.string().min(1).describe("HTS passport token ID"),
  serial: z.number().int().positive().describe("NFT serial number"),
  reason: z.string().optional().describe("Revocation reason"),
};

/** Register all 6 passport MCP tools. */
export function registerPassportTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "request_passport",
    "Issue a new agent passport NFT. Requires x402 payment for the selected tier.",
    requestPassportSchema,
    async (args) => {
      try {
        const result = await issuePassport(
          args.accountId as string,
          args.signature as string,
          args.tier as "bronze" | "silver" | "gold" | "platinum",
          args.name as string,
          args.capabilities as Capability[],
          args.endpoint as string | undefined,
          args.skills as string[] | undefined,
          args.imageUrl as string | undefined,
        );
        return ok(result);
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "authenticated" },
  );

  r.registerTool(
    "upload_image",
    "Upload an image to IPFS and return an ipfs:// URI. Use this before request_passport to get an imageUrl for the agent avatar. Accepts base64-encoded image data.",
    uploadImageSchema,
    async (args) => {
      try {
        const buffer = Buffer.from(args.base64Data as string, "base64");
        const uri = await uploadImage(
          buffer,
          args.filename as string,
          args.mimeType as string,
        );
        return ok({ uri, filename: args.filename });
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "authenticated" },
  );

  r.registerTool(
    "verify_passport",
    "Verify a passport's on-chain status: active, tier, capabilities, DID, owner.",
    passportIdSchema,
    async (args) => {
      try {
        const info = await getPassportInfo(args.tokenId as string, args.serial as number);
        if (!info) {
          return { isError: true, content: [{ type: "text", text: "Passport not found" }] };
        }
        return ok(info);
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "public", publicTier: "curated" },
  );

  r.registerTool(
    "get_passport",
    "Get passport metadata: tier, capabilities, DID, owner, endpoint. Same as verify_passport for MVP.",
    passportIdSchema,
    async (args) => {
      try {
        const info = await getPassportInfo(args.tokenId as string, args.serial as number);
        if (!info) {
          return { isError: true, content: [{ type: "text", text: "Passport not found" }] };
        }
        return ok(info);
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "public", publicTier: "curated" },
  );

  r.registerTool(
    "list_passports",
    "List all issued passports for the configured token collection.",
    {},
    async () => {
      try {
        const tokenId = process.env.PASSPORT_TOKEN_ID;
        if (!tokenId) {
          return {
            isError: true,
            content: [{ type: "text", text: "PASSPORT_TOKEN_ID not configured" }],
          };
        }
        const passports = await listAllPassports(tokenId);
        return ok({ passports });
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "public", publicTier: "curated" },
  );

  r.registerTool(
    "upgrade_tier",
    "Upgrade a passport to a higher tier. Owner path: verified DID signature matching did:hcs:{tokenId}:{serial}; operator path: admin access. Updates NFT metadata and submits HCS audit message.",
    upgradeTierSchema,
    async (args, ctx) => {
      try {
        const tokenId = args.tokenId as string;
        const serial = args.serial as number;
        const newTier = args.newTier as "bronze" | "silver" | "gold" | "platinum";

        // EPIC-259 (SLICE-259-4): requester identity comes from verified
        // context — owner DID signature or admin — never from args.
        let accountId: string | null;
        if (ctx?.callerTier === "admin") {
          const info = await getPassportInfo(tokenId, serial);
          if (!info) {
            return { isError: true, content: [{ type: "text", text: "Passport not found" }] };
          }
          accountId = info.owner;
        } else {
          const did = ctx?.verifiedDid;
          if (!did) {
            return {
              isError: true,
              content: [{ type: "text", text: `upgrade_tier requires a verified DID signature matching did:hcs:${tokenId}:${serial} (agb_ keys cannot prove Hedera passport ownership) or admin access` }],
            };
          }
          const parsed = extractTokenAndSerial(did);
          if (!parsed || parsed.tokenId !== tokenId || parsed.serial !== serial) {
            return {
              isError: true,
              content: [{ type: "text", text: "Verified DID does not match the target passport" }],
            };
          }
          accountId = await didToAccountId(did);
          if (!accountId) {
            return {
              isError: true,
              content: [{ type: "text", text: "Verified DID does not resolve to a Hedera account" }],
            };
          }
        }

        const result = await upgradeTier(tokenId, serial, newTier, accountId);
        return ok(result);
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "authenticated" },
  );

  r.registerTool(
    "revoke_passport",
    "Revoke a passport (admin only). Wipes the NFT and submits a passport_revoked audit message.",
    revokePassportSchema,
    async (args) => {
      try {
        const result = await revokePassport(
          args.tokenId as string,
          args.serial as number,
          (args.reason as string) ?? "",
        );
        return ok(result);
      } catch (e) {
        return serviceErrorToMcpError(e);
      }
    },
    { exposure: "admin" },
  );
}
