import {
  homeAssistantSyncProfileSchema,
  homeAssistantSyncProfileStoreSchema,
  homeAssistantSyncProfileStoreSnapshotSchema,
  homeAssistantSyncProfileTemplateSchema,
  homeAssistantSyncSourceSchema,
  HOME_ASSISTANT_DEFAULT_PROFILE_ID,
  HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
} from "./haSchemas";
import type {
  HomeAssistantEntityLink,
  HomeAssistantProductionSyncInput,
  HomeAssistantProductionSyncProfile,
  HomeAssistantSyncProfileStore,
  HomeAssistantSyncProfileStoreSnapshot,
  HomeAssistantSyncProfileTemplate,
  HomeAssistantThreshold,
} from "./haSchemas";

export function normalizeEntityList(values?: string[]): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const uniqueValues = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    uniqueValues.add(trimmed);
  }
  return uniqueValues.size > 0 ? Array.from(uniqueValues) : undefined;
}

export function normalizeThresholds(
  thresholds?: Record<string, HomeAssistantThreshold>,
): Record<string, { max?: number; min?: number; warn_margin_pct?: number }> | undefined {
  if (!thresholds) return undefined;

  const normalized: Record<string, { max?: number; min?: number; warn_margin_pct?: number }> =
    {};
  for (const [entityId, threshold] of Object.entries(thresholds)) {
    if (!threshold) continue;
    normalized[entityId] = {
      max: typeof threshold.max === "number" ? threshold.max : undefined,
      min: typeof threshold.min === "number" ? threshold.min : undefined,
      warn_margin_pct:
        typeof threshold.warnMarginPct === "number" ? threshold.warnMarginPct : undefined,
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeEntityLinks(
  entityLinks?: Record<string, HomeAssistantEntityLink>,
): Record<string, {
  equipment_id?: string;
  location_id?: string;
  reading_type?: string;
  sensor_code?: string;
  unit?: string;
}> | undefined {
  if (!entityLinks) return undefined;

  const normalized: Record<string, {
    equipment_id?: string;
    location_id?: string;
    reading_type?: string;
    sensor_code?: string;
    unit?: string;
  }> = {};

  for (const [entityId, link] of Object.entries(entityLinks)) {
    if (!link) continue;
    const normalizedEntityId = entityId.trim();
    if (normalizedEntityId.length === 0) continue;

    normalized[normalizedEntityId] = {
      equipment_id: link.equipmentId?.trim() || undefined,
      location_id: link.locationId?.trim() || undefined,
      reading_type: link.readingType?.trim() || undefined,
      sensor_code: link.sensorCode?.trim() || undefined,
      unit: link.unit?.trim() || undefined,
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeProfileEntityLinks(
  entityLinks: unknown,
): Record<string, HomeAssistantEntityLink> {
  if (!entityLinks || typeof entityLinks !== "object" || Array.isArray(entityLinks)) {
    return {};
  }

  const normalized: Record<string, HomeAssistantEntityLink> = {};
  for (const [entityId, rawLink] of Object.entries(
    entityLinks as Record<string, unknown>,
  )) {
    if (!rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) continue;

    const normalizedEntityId = entityId.trim();
    if (normalizedEntityId.length === 0) continue;

    const normalizedLink: HomeAssistantEntityLink = {
      equipmentId: normalizeOptionalString((rawLink as Record<string, unknown>).equipmentId) ?? undefined,
      locationId: normalizeOptionalString((rawLink as Record<string, unknown>).locationId) ?? undefined,
      readingType: normalizeOptionalString((rawLink as Record<string, unknown>).readingType) ?? undefined,
      sensorCode: normalizeOptionalString((rawLink as Record<string, unknown>).sensorCode) ?? undefined,
      unit: normalizeOptionalString((rawLink as Record<string, unknown>).unit) ?? undefined,
    };

    if (
      !normalizedLink.equipmentId &&
      !normalizedLink.locationId &&
      !normalizedLink.readingType &&
      !normalizedLink.sensorCode &&
      !normalizedLink.unit
    ) {
      continue;
    }

    normalized[normalizedEntityId] = normalizedLink;
  }

  return normalized;
}

export function createDefaultSyncProfile(): HomeAssistantProductionSyncProfile {
  return {
    availabilityEntities: [],
    batchId: null,
    dryRun: false,
    entityLinks: {},
    equipmentId: null,
    includeAllNumericSensors: false,
    locationId: null,
    sensorEntities: [],
    source: "homeassistant",
  };
}

export function normalizeSyncProfile(raw: unknown): HomeAssistantProductionSyncProfile {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const sourceCandidate = record.source;
  const parsedSource = homeAssistantSyncSourceSchema.safeParse(sourceCandidate);

  const normalized: HomeAssistantProductionSyncProfile = {
    availabilityEntities: normalizeEntityList(
      Array.isArray(record.availabilityEntities)
        ? (record.availabilityEntities as string[])
        : undefined,
    ) ?? [],
    batchId: normalizeOptionalString(record.batchId),
    dryRun: record.dryRun === true,
    entityLinks: normalizeProfileEntityLinks(record.entityLinks),
    equipmentId: normalizeOptionalString(record.equipmentId),
    includeAllNumericSensors: record.includeAllNumericSensors === true,
    locationId: normalizeOptionalString(record.locationId),
    sensorEntities: normalizeEntityList(
      Array.isArray(record.sensorEntities)
        ? (record.sensorEntities as string[])
        : undefined,
    ) ?? [],
    source: parsedSource.success ? parsedSource.data : "homeassistant",
  };

  const parsed = homeAssistantSyncProfileSchema.safeParse(normalized);
  if (!parsed.success) {
    return createDefaultSyncProfile();
  }

  return parsed.data;
}

export function normalizeSyncProfileTemplate(
  raw: unknown,
  index: number,
): HomeAssistantSyncProfileTemplate | null {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const id = normalizeOptionalString(record.id) ?? `profile-${index + 1}`;
  const name = normalizeOptionalString(record.name) ?? `Profile ${index + 1}`;
  const description = normalizeOptionalString(record.description);
  const flowNodeId = normalizeOptionalString(record.flowNodeId);
  const updatedAt = normalizeOptionalString(record.updatedAt) ?? new Date().toISOString();
  const config = normalizeSyncProfile(record.config);

  const parsed = homeAssistantSyncProfileTemplateSchema.safeParse({
    config,
    description,
    flowNodeId,
    id,
    name,
    updatedAt,
  });

  return parsed.success ? parsed.data : null;
}

export function profileHasMeaningfulData(profile: HomeAssistantProductionSyncProfile): boolean {
  return (
    profile.availabilityEntities.length > 0 ||
    profile.batchId !== null ||
    profile.dryRun ||
    Object.keys(profile.entityLinks).length > 0 ||
    profile.equipmentId !== null ||
    profile.includeAllNumericSensors ||
    profile.locationId !== null ||
    profile.sensorEntities.length > 0 ||
    profile.source !== "homeassistant"
  );
}

export function createEmptySyncProfileStore(): HomeAssistantSyncProfileStore {
  return {
    activeProfileId: null,
    profiles: [],
    version: HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
  };
}

export function normalizeSyncProfileStore(raw: unknown): HomeAssistantSyncProfileStore {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const rawProfiles = Array.isArray(record.profiles) ? record.profiles : null;
  if (rawProfiles) {
    const uniqueIds = new Set<string>();
    const normalizedProfiles: HomeAssistantSyncProfileTemplate[] = [];

    for (const [index, rawProfile] of rawProfiles.entries()) {
      const normalized = normalizeSyncProfileTemplate(rawProfile, index);
      if (!normalized) continue;

      if (uniqueIds.has(normalized.id)) {
        const suffixed = `${normalized.id}-${index + 1}`;
        normalizedProfiles.push({
          ...normalized,
          id: suffixed,
        });
        uniqueIds.add(suffixed);
      } else {
        normalizedProfiles.push(normalized);
        uniqueIds.add(normalized.id);
      }
    }

    const activeCandidate = normalizeOptionalString(record.activeProfileId);
    const resolvedActiveProfileId =
      activeCandidate && normalizedProfiles.some((profile) => profile.id === activeCandidate)
        ? activeCandidate
        : (normalizedProfiles[0]?.id ?? null);

    const parsed = homeAssistantSyncProfileStoreSchema.safeParse({
      activeProfileId: resolvedActiveProfileId,
      profiles: normalizedProfiles,
      version:
        typeof record.version === "number" && Number.isFinite(record.version) && record.version > 0
          ? Math.floor(record.version)
          : HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
    });

    if (parsed.success) {
      return parsed.data;
    }
  }

  const legacyProfile = normalizeSyncProfile(raw);
  if (profileHasMeaningfulData(legacyProfile)) {
    return {
      activeProfileId: HOME_ASSISTANT_DEFAULT_PROFILE_ID,
      profiles: [
        {
          config: legacyProfile,
          description: null,
          flowNodeId: null,
          id: HOME_ASSISTANT_DEFAULT_PROFILE_ID,
          name: "Default profile",
          updatedAt: new Date().toISOString(),
        },
      ],
      version: HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
    };
  }

  return createEmptySyncProfileStore();
}

export function normalizeProfileStoreForSave(
  store: HomeAssistantSyncProfileStore,
): HomeAssistantSyncProfileStore {
  const normalizedProfiles: HomeAssistantSyncProfileTemplate[] = [];
  const usedIds = new Set<string>();

  for (const [index, profile] of store.profiles.entries()) {
    const normalizedTemplate = normalizeSyncProfileTemplate(profile, index);
    if (!normalizedTemplate) continue;

    const uniqueId = usedIds.has(normalizedTemplate.id)
      ? `${normalizedTemplate.id}-${index + 1}`
      : normalizedTemplate.id;
    usedIds.add(uniqueId);

    normalizedProfiles.push({
      ...normalizedTemplate,
      id: uniqueId,
    });
  }

  const activeProfileId =
    store.activeProfileId && normalizedProfiles.some((profile) => profile.id === store.activeProfileId)
      ? store.activeProfileId
      : (normalizedProfiles[0]?.id ?? null);

  return {
    activeProfileId,
    profiles: normalizedProfiles,
    version: HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
  };
}

export function normalizeSyncProfileStoreSnapshot(raw: unknown): HomeAssistantSyncProfileStoreSnapshot {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "value" in (raw as Record<string, unknown>)
  ) {
    const record = raw as Record<string, unknown>;
    const normalizedSnapshot = {
      store: normalizeSyncProfileStore(record.value),
      updatedAt: normalizeOptionalString(record.updated_at),
    };

    const parsed = homeAssistantSyncProfileStoreSnapshotSchema.safeParse(normalizedSnapshot);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const parsedFallback = homeAssistantSyncProfileStoreSnapshotSchema.safeParse({
    store: normalizeSyncProfileStore(raw),
    updatedAt: null,
  });

  if (parsedFallback.success) {
    return parsedFallback.data;
  }

  return {
    store: createEmptySyncProfileStore(),
    updatedAt: null,
  };
}

export function isGetSystemConfigMetaUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  return message.includes("p_with_meta");
}

export function normalizeMappingProfileContext(
  mappingProfile?: HomeAssistantProductionSyncInput["mappingProfile"],
):
  | {
    flow_node_id?: string;
    id?: string;
    name?: string;
  }
  | undefined {
  if (!mappingProfile) return undefined;

  const id = normalizeOptionalString(mappingProfile.id) ?? undefined;
  const name = normalizeOptionalString(mappingProfile.name) ?? undefined;
  const flowNodeId = normalizeOptionalString(mappingProfile.flowNodeId) ?? undefined;

  if (!id && !name && !flowNodeId) {
    return undefined;
  }

  return {
    ...(flowNodeId ? { flow_node_id: flowNodeId } : {}),
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

export function resolveActiveProfileTemplate(
  store: HomeAssistantSyncProfileStore,
): HomeAssistantSyncProfileTemplate | null {
  if (store.activeProfileId) {
    const activeProfile = store.profiles.find(
      (profile) => profile.id === store.activeProfileId,
    );
    if (activeProfile) {
      return activeProfile;
    }
  }

  return store.profiles[0] ?? null;
}
