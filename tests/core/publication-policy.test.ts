import { describe, expect, it } from "vitest";
import { decideUpload, loadPublicationConfig, type PublicationConfig } from "@/src/core/publication-policy";

const production: PublicationConfig = { mode: "assisted", publicPublicationEnabled: true, environment: "production" };
const authorization = { authorizedBy: "editor", authorizedAt: "2026-11-05T10:00:00Z" };

describe("loadPublicationConfig", () => {
  it("defaults to manual with public publication off", () => {
    expect(loadPublicationConfig({})).toEqual({ mode: "manual", publicPublicationEnabled: false, environment: "development" });
  });

  it("refuses automatic mode outside production", () => {
    expect(() => loadPublicationConfig({ PUBLICATION_MODE: "automatic" })).toThrow(/automatic/);
    expect(() => loadPublicationConfig({ PUBLICATION_MODE: "automatic", OGNIORA_ENV: "staging" })).toThrow();
  });

  it("rejects unknown values instead of falling back", () => {
    expect(() => loadPublicationConfig({ PUBLICATION_MODE: "yolo" })).toThrow();
    expect(() => loadPublicationConfig({ ALLOW_PUBLIC_PUBLICATION: "1" })).toThrow();
  });
});

describe("decideUpload", () => {
  it("blocks anything not approved, including private uploads", () => {
    expect(decideUpload(production, { requestedPrivacy: "private", scriptApproved: false })).toEqual({ allowed: false, reason: "script_not_approved" });
  });

  it("allows private and unlisted test uploads with the default config", () => {
    const config = loadPublicationConfig({});
    expect(decideUpload(config, { requestedPrivacy: "private", scriptApproved: true })).toEqual({ allowed: true, privacy: "private" });
    expect(decideUpload(config, { requestedPrivacy: "unlisted", scriptApproved: true })).toEqual({ allowed: true, privacy: "unlisted" });
  });

  it("refuses public with the default config even when authorized", () => {
    const decision = decideUpload(loadPublicationConfig({}), { requestedPrivacy: "public", scriptApproved: true, publicAuthorization: authorization });
    expect(decision).toEqual({ allowed: false, reason: "public_disabled" });
  });

  it("refuses public in staging even with the switch on", () => {
    const decision = decideUpload({ ...production, environment: "staging" }, { requestedPrivacy: "public", scriptApproved: true, publicAuthorization: authorization });
    expect(decision).toEqual({ allowed: false, reason: "public_disabled" });
  });

  it("requires an explicit authorization record for public", () => {
    expect(decideUpload(production, { requestedPrivacy: "public", scriptApproved: true })).toEqual({ allowed: false, reason: "public_not_authorized" });
    expect(decideUpload(production, { requestedPrivacy: "public", scriptApproved: true, publicAuthorization: authorization })).toEqual({ allowed: true, privacy: "public" });
  });
});
