import { z } from "zod";

export const PUBLICATION_MODES = ["manual", "assisted", "automatic"] as const;
export const PRIVACY_STATUSES = ["private", "unlisted", "public"] as const;

export type PublicationMode = (typeof PUBLICATION_MODES)[number];
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];

const envSchema = z.object({
  PUBLICATION_MODE: z.enum(PUBLICATION_MODES).default("manual"),
  ALLOW_PUBLIC_PUBLICATION: z.enum(["true", "false"]).default("false"),
  OGNIORA_ENV: z.enum(["development", "staging", "production"]).default("development"),
});

export interface PublicationConfig {
  mode: PublicationMode;
  publicPublicationEnabled: boolean;
  environment: "development" | "staging" | "production";
}

/** Reads the policy from the environment. Anything unset resolves to the safest value. */
export function loadPublicationConfig(env: Record<string, string | undefined>): PublicationConfig {
  const parsed = envSchema.parse(env);
  const config: PublicationConfig = {
    mode: parsed.PUBLICATION_MODE,
    publicPublicationEnabled: parsed.ALLOW_PUBLIC_PUBLICATION === "true",
    environment: parsed.OGNIORA_ENV,
  };
  if (config.mode === "automatic" && config.environment !== "production") {
    throw new Error("PUBLICATION_MODE=automatic is only valid with OGNIORA_ENV=production");
  }
  return config;
}

export interface PublicAuthorization {
  authorizedBy: string;
  authorizedAt: string;
}

export interface UploadRequest {
  requestedPrivacy: PrivacyStatus;
  scriptApproved: boolean;
  publicAuthorization?: PublicAuthorization | null;
}

export type UploadDecision =
  | { allowed: true; privacy: PrivacyStatus }
  | { allowed: false; reason: "script_not_approved" | "public_disabled" | "public_not_authorized" };

/**
 * The only function that decides the privacy status sent to YouTube. The API
 * defaults to public when the field is omitted, so callers must always send the
 * returned value. The database enforces the same rule as a second barrier.
 */
export function decideUpload(config: PublicationConfig, request: UploadRequest): UploadDecision {
  if (!request.scriptApproved) return { allowed: false, reason: "script_not_approved" };
  if (request.requestedPrivacy !== "public") return { allowed: true, privacy: request.requestedPrivacy };
  if (!config.publicPublicationEnabled || config.environment !== "production") {
    return { allowed: false, reason: "public_disabled" };
  }
  if (!request.publicAuthorization) return { allowed: false, reason: "public_not_authorized" };
  return { allowed: true, privacy: "public" };
}
