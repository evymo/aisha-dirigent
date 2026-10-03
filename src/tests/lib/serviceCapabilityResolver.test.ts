import { describe, expect, it } from "vitest";
import {
  resolveIntegrationCapabilityDetails,
  resolveIntegrationCapabilitySourceSummary,
  resolveIntegrationCapabilities,
  resolveIntegrationLaunchUrl,
} from "@/lib/integrations/serviceCapabilityResolver";
import type { IntegrationService } from "@/schemas/integrationServiceSchemas";

function createService(
  serviceName: string,
  config: Record<string, unknown> | null = null,
): IntegrationService {
  return {
    id: "309771ef-0802-4e0d-ab53-a5e4ef90acc8",
    service_name: serviceName,
    display_name: serviceName,
    service_type: "admin",
    base_url: `https://${serviceName}.aisha.guru`,
    config,
    health_status: "healthy",
    last_health_check: null,
    is_active: true,
    managed_by: "aisha",
    created_at: "2026-03-31T10:00:00Z",
    updated_at: "2026-03-31T10:00:00Z",
  };
}

describe("serviceCapabilityResolver", () => {
  it("uses service defaults when config is missing", () => {
    const appsmith = createService("appsmith", null);
    const langfuse = createService("langfuse", null);

    expect(resolveIntegrationCapabilities(appsmith)).toEqual({
      contextSyncEnabled: true,
      embedEnabled: true,
      ssoEnabled: true,
    });

    expect(resolveIntegrationCapabilities(langfuse)).toEqual({
      contextSyncEnabled: false,
      embedEnabled: false,
      ssoEnabled: true,
    });
  });

  it("respects explicit config booleans over defaults", () => {
    const service = createService("appsmith", {
      embed_enabled: false,
      sso_enabled: true,
      context_sync_enabled: false,
    });

    expect(resolveIntegrationCapabilities(service)).toEqual({
      contextSyncEnabled: false,
      embedEnabled: false,
      ssoEnabled: true,
    });
  });

  it("accepts camelCase aliases in config", () => {
    const service = createService("n8n", {
      embedEnabled: true,
      ssoEnabled: false,
      contextSyncEnabled: true,
    });

    expect(resolveIntegrationCapabilities(service)).toEqual({
      contextSyncEnabled: true,
      embedEnabled: true,
      ssoEnabled: false,
    });
  });

  it("infers embed capability from embed_path even without explicit flag", () => {
    const service = createService("langfuse", {
      embed_path: "/app/dashboard",
    });

    expect(resolveIntegrationCapabilities(service).embedEnabled).toBe(true);
  });

  it("returns source metadata for resolved capabilities", () => {
    const inferred = createService("langfuse", {
      embed_path: "/app/dashboard",
    });

    expect(resolveIntegrationCapabilityDetails(inferred)).toEqual({
      contextSyncEnabled: { source: "default", value: false },
      embedEnabled: { source: "inferred", value: true },
      ssoEnabled: { source: "default", value: true },
    });

    const explicit = createService("appsmith", {
      context_sync_enabled: false,
      embed_enabled: false,
      sso_enabled: false,
    });

    expect(resolveIntegrationCapabilityDetails(explicit)).toEqual({
      contextSyncEnabled: { source: "explicit", value: false },
      embedEnabled: { source: "explicit", value: false },
      ssoEnabled: { source: "explicit", value: false },
    });
  });

  it("returns summarized capability source", () => {
    const inferred = createService("langfuse", {
      embed_path: "/app/dashboard",
    });
    expect(resolveIntegrationCapabilitySourceSummary(inferred)).toBe("mixed");

    const explicit = createService("appsmith", {
      context_sync_enabled: false,
      embed_enabled: false,
      sso_enabled: false,
    });
    expect(resolveIntegrationCapabilitySourceSummary(explicit)).toBe("explicit");

    const defaults = createService("n8n", null);
    expect(resolveIntegrationCapabilitySourceSummary(defaults)).toBe("default");
  });

  it("resolves launch URL with relative sso_path", () => {
    const service = createService("langfuse", { sso_path: "/auth/sso" });
    expect(resolveIntegrationLaunchUrl(service)).toBe("https://langfuse.aisha.guru/auth/sso");
  });

  it("resolves launch URL with absolute ssoPath", () => {
    const service = createService("n8n", { ssoPath: "https://sso.example.com/start" });
    expect(resolveIntegrationLaunchUrl(service)).toBe("https://sso.example.com/start");
  });
});
