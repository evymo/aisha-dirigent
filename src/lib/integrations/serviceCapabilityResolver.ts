import type { IntegrationService } from "@/schemas/integrationServiceSchemas";

export interface IntegrationServiceCapabilities {
  contextSyncEnabled: boolean;
  embedEnabled: boolean;
  ssoEnabled: boolean;
}

export type IntegrationCapabilitySource = "explicit" | "inferred" | "default";

export interface IntegrationCapabilityDetail {
  source: IntegrationCapabilitySource;
  value: boolean;
}

export interface IntegrationServiceCapabilityDetails {
  contextSyncEnabled: IntegrationCapabilityDetail;
  embedEnabled: IntegrationCapabilityDetail;
  ssoEnabled: IntegrationCapabilityDetail;
}

export type IntegrationCapabilitySourceSummary = IntegrationCapabilitySource | "mixed";

const SERVICE_DEFAULT_CAPABILITIES: Record<string, IntegrationServiceCapabilities> = {
  appsmith: { contextSyncEnabled: true, embedEnabled: true, ssoEnabled: true },
  langfuse: { contextSyncEnabled: false, embedEnabled: false, ssoEnabled: true },
  n8n: { contextSyncEnabled: false, embedEnabled: false, ssoEnabled: true },
};

function toBoolean(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1) {
    return true;
  }
  if (value === false || value === "false" || value === 0) {
    return false;
  }
  return null;
}

function getConfig(service: IntegrationService | null | undefined) {
  if (!service || typeof service.config !== "object" || service.config === null) {
    return null;
  }
  return service.config as Record<string, unknown>;
}

function coalesceBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    const normalized = toBoolean(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

export function resolveIntegrationCapabilities(
  service: IntegrationService | null | undefined,
): IntegrationServiceCapabilities {
  const details = resolveIntegrationCapabilityDetails(service);
  return {
    contextSyncEnabled: details.contextSyncEnabled.value,
    embedEnabled: details.embedEnabled.value,
    ssoEnabled: details.ssoEnabled.value,
  };
}

export function resolveIntegrationCapabilityDetails(
  service: IntegrationService | null | undefined,
): IntegrationServiceCapabilityDetails {
  const fallback = service
    ? (SERVICE_DEFAULT_CAPABILITIES[service.service_name] ?? {
        contextSyncEnabled: false,
        embedEnabled: false,
        ssoEnabled: false,
      })
    : { contextSyncEnabled: false, embedEnabled: false, ssoEnabled: false };

  const config = getConfig(service);

  const ssoExplicit = coalesceBoolean(config?.sso_enabled, config?.ssoEnabled);
  const ssoEnabled = ssoExplicit ?? fallback.ssoEnabled;
  const ssoSource: IntegrationCapabilitySource = ssoExplicit !== null ? "explicit" : "default";

  const embedExplicit = coalesceBoolean(config?.embed_enabled, config?.embedEnabled);
  const embedInferred =
    embedExplicit === null &&
    (typeof config?.embed_path === "string" || typeof config?.embed_url === "string");
  const embedEnabled = embedExplicit ?? (embedInferred ? true : fallback.embedEnabled);
  const embedSource: IntegrationCapabilitySource = embedExplicit !== null
    ? "explicit"
    : embedInferred
      ? "inferred"
      : "default";

  const contextExplicit = coalesceBoolean(
    config?.context_sync_enabled,
    config?.contextSyncEnabled,
  );
  const contextSyncEnabled = contextExplicit ?? fallback.contextSyncEnabled;
  const contextSource: IntegrationCapabilitySource = contextExplicit !== null ? "explicit" : "default";

  return {
    contextSyncEnabled: {
      source: contextSource,
      value: contextSyncEnabled,
    },
    embedEnabled: {
      source: embedSource,
      value: embedEnabled,
    },
    ssoEnabled: {
      source: ssoSource,
      value: ssoEnabled,
    },
  };
}

export function resolveIntegrationLaunchUrl(service: IntegrationService | null | undefined): string | null {
  if (!service) {
    return null;
  }

  const config = getConfig(service);
  const ssoPath =
    typeof config?.sso_path === "string"
      ? config.sso_path.trim()
      : typeof config?.ssoPath === "string"
        ? config.ssoPath.trim()
        : "";

  if (!ssoPath) {
    return service.base_url;
  }

  if (ssoPath.startsWith("http://") || ssoPath.startsWith("https://")) {
    return ssoPath;
  }

  return `${service.base_url.replace(/\/+$/, "")}/${ssoPath.replace(/^\/+/, "")}`;
}

export function resolveIntegrationCapabilitySourceSummary(
  service: IntegrationService | null | undefined,
): IntegrationCapabilitySourceSummary {
  const details = resolveIntegrationCapabilityDetails(service);
  const sources = new Set([
    details.ssoEnabled.source,
    details.embedEnabled.source,
    details.contextSyncEnabled.source,
  ]);

  if (sources.size === 1) {
    return Array.from(sources)[0] as IntegrationCapabilitySource;
  }

  return "mixed";
}
