/**
 * @fileoverview Pure utility functions and constants for IoT integration section.
 * Extracted from FlowIotIntegrationSection.tsx for maintainability.
 */

import type { HomeAssistantEntityLink, HomeAssistantSyncProfileTemplate } from "@/hooks";

export const NONE_OPTION_VALUE = "__none__";
export const ALL_READING_TYPES_VALUE = "__all__";
export const NEW_PROFILE_VALUE = "__new_profile__";

export const READING_TYPE_OPTIONS = [
  "temperature",
  "humidity",
  "pressure",
  "co2",
  "flow_rate",
  "power",
  "custom",
] as const;

export const SOURCE_OPTIONS = [
  "homeassistant",
  "manual",
  "plc",
  "lims",
  "iot_gateway",
  "scada",
] as const;

export type SyncSource = (typeof SOURCE_OPTIONS)[number];

/**
 * Parse newline/comma-separated entity list into deduplicated array.
 */
export function parseEntityList(rawInput: string): string[] {
  const values = rawInput
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return Array.from(new Set(values));
}

/**
 * Filter and normalize entity link metadata, removing empty entries.
 */
export function normalizeEntityLinkInput(
  links: Record<string, HomeAssistantEntityLink>,
  allowedEntityIds: string[],
): Record<string, HomeAssistantEntityLink> | undefined {
  const allowed = new Set(allowedEntityIds);
  const normalized: Record<string, HomeAssistantEntityLink> = {};

  for (const [entityId, link] of Object.entries(links)) {
    if (!allowed.has(entityId)) continue;

    const nextLink: HomeAssistantEntityLink = {
      equipmentId: link.equipmentId?.trim() || undefined,
      locationId: link.locationId?.trim() || undefined,
      readingType: link.readingType?.trim() || undefined,
      sensorCode: link.sensorCode?.trim() || undefined,
      unit: link.unit?.trim() || undefined,
    };

    if (
      !nextLink.equipmentId &&
      !nextLink.locationId &&
      !nextLink.readingType &&
      !nextLink.sensorCode &&
      !nextLink.unit
    ) {
      continue;
    }

    normalized[entityId] = nextLink;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Convert NONE_OPTION_VALUE sentinel to undefined.
 */
export function optionalValue(value: string): string | undefined {
  return value === NONE_OPTION_VALUE ? undefined : value;
}

/**
 * Convert profile name to URL-friendly slug (max 48 chars).
 */
export function slugifyProfileName(rawName: string): string {
  const normalized = rawName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return "profile";
  }

  return normalized.slice(0, 48);
}

/**
 * Generate a unique profile ID by appending a numeric suffix if needed.
 */
export function buildUniqueProfileId(
  profileName: string,
  existingProfiles: HomeAssistantSyncProfileTemplate[],
): string {
  const baseId = slugifyProfileName(profileName);
  const usedIds = new Set(existingProfiles.map((profile) => profile.id));

  if (!usedIds.has(baseId)) {
    return baseId;
  }

  let suffixCounter = 2;
  while (usedIds.has(`${baseId}-${suffixCounter}`)) {
    suffixCounter += 1;
  }

  return `${baseId}-${suffixCounter}`;
}

/**
 * Check if an error represents a system_config_conflict (optimistic concurrency failure).
 */
export function isSystemConfigConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  return message.includes("system_config_conflict");
}
