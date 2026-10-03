import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  homeAssistantHealthSchema,
  homeAssistantSyncSchema,
  HOME_ASSISTANT_DEFAULT_PROFILE_ID,
  HOME_ASSISTANT_SYNC_PROFILE_KEY,
  HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
} from "./haSchemas";
import type {
  HomeAssistantHealth,
  HomeAssistantProductionSyncInput,
  HomeAssistantProductionSyncResult,
  HomeAssistantProductionSyncProfile,
  HomeAssistantSyncProfileStore,
  HomeAssistantSyncProfileStoreSnapshot,
  SaveHomeAssistantSyncProfileStoreInput,
} from "./haSchemas";
import {
  createDefaultSyncProfile,
  isGetSystemConfigMetaUnsupportedError,
  normalizeEntityLinks,
  normalizeEntityList,
  normalizeMappingProfileContext,
  normalizeProfileStoreForSave,
  normalizeSyncProfile,
  normalizeSyncProfileStoreSnapshot,
  normalizeThresholds,
  resolveActiveProfileTemplate,
} from "./haHelpers";

/**
 * Performs a Home Assistant integration health check.
 *
 * @returns Integration health data including selected transport and HA version.
 */
export async function fetchHomeAssistantHealth(): Promise<HomeAssistantHealth> {
  const { data, error } = await aisha.functions.invoke("homeassistant-api", {
    body: {
      action: "health",
    },
  });

  if (error) {
    safeError("homeAssistant.health.invokeFailed", error);
    throw new Error(error.message);
  }

  const parsed = homeAssistantHealthSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Home Assistant health response is invalid");
  }

  return parsed.data;
}

/**
 * Fetches persisted Home Assistant production sync profile from system config.
 *
 * @returns Normalized profile with defaults when no profile exists.
 */
export async function fetchHomeAssistantSyncProfile(): Promise<HomeAssistantProductionSyncProfile> {
  const store = await fetchHomeAssistantSyncProfileStore();
  return resolveActiveProfileTemplate(store)?.config ?? createDefaultSyncProfile();
}

/**
 * Fetches persisted Home Assistant sync profile store snapshot from system config.
 *
 * @returns Normalized store and its current DB updated timestamp.
 */
export async function fetchHomeAssistantSyncProfileStoreSnapshot(): Promise<HomeAssistantSyncProfileStoreSnapshot> {
  const { data, error } = await aisha.rpc("get_system_config", {
    p_key: HOME_ASSISTANT_SYNC_PROFILE_KEY,
    p_with_meta: true,
  });

  if (error) {
    if (!isGetSystemConfigMetaUnsupportedError(error)) {
      safeError("homeAssistant.profile.fetchFailed", error);
      throw new Error(error.message);
    }

    const legacyResponse = await aisha.rpc("get_system_config", {
      p_key: HOME_ASSISTANT_SYNC_PROFILE_KEY,
    });
    if (legacyResponse.error) {
      safeError("homeAssistant.profile.fetchFailed", legacyResponse.error);
      throw legacyResponse.error;
    }

    return normalizeSyncProfileStoreSnapshot(legacyResponse.data);
  }

  return normalizeSyncProfileStoreSnapshot(data);
}

/**
 * Fetches persisted Home Assistant sync profile store from system config.
 *
 * @returns Normalized profile store with active profile and named templates.
 */
export async function fetchHomeAssistantSyncProfileStore(): Promise<HomeAssistantSyncProfileStore> {
  const snapshot = await fetchHomeAssistantSyncProfileStoreSnapshot();
  return snapshot.store;
}

/**
 * Persists Home Assistant production sync profile for reusing entity mappings.
 *
 * @param profile - Profile payload to store in system_config.
 */
export async function saveHomeAssistantSyncProfile(
  profile: HomeAssistantProductionSyncProfile,
): Promise<void> {
  const normalizedProfile = normalizeSyncProfile(profile);
  const normalizedStore: HomeAssistantSyncProfileStore = {
    activeProfileId: HOME_ASSISTANT_DEFAULT_PROFILE_ID,
    profiles: [
      {
        config: normalizedProfile,
        description: null,
        flowNodeId: null,
        id: HOME_ASSISTANT_DEFAULT_PROFILE_ID,
        name: "Default profile",
        updatedAt: new Date().toISOString(),
      },
    ],
    version: HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION,
  };

  await saveHomeAssistantSyncProfileStore({
    store: normalizedStore,
  });
}

/**
 * Persists Home Assistant sync profile store for reusing context-specific mappings.
 *
 * @param input - Profile store payload and optional expected timestamp for CAS update.
 * @returns Persisted normalized profile store snapshot.
 */
export async function saveHomeAssistantSyncProfileStore(
  input: SaveHomeAssistantSyncProfileStoreInput,
): Promise<HomeAssistantSyncProfileStoreSnapshot> {
  const normalizedStore = normalizeProfileStoreForSave(input.store);
  const { error } = await aisha.rpc("set_system_config_admin", {
    p_category: "integrations",
    p_description: "Home Assistant production sync profile store",
    p_expected_updated_at: input.expectedUpdatedAt ?? undefined,
    p_is_public: false,
    p_key: HOME_ASSISTANT_SYNC_PROFILE_KEY,
    p_value: normalizedStore,
  });

  if (error) {
    safeError("homeAssistant.profile.saveFailed", error);
    throw new Error(error.message);
  }

  return fetchHomeAssistantSyncProfileStoreSnapshot();
}

/**
 * Syncs production telemetry and availability states from Home Assistant.
 *
 * @param input - Entity selection and optional link metadata for production records.
 * @returns Summary and detail of synced records.
 */
export async function syncHomeAssistantProductionData(
  input: HomeAssistantProductionSyncInput,
): Promise<HomeAssistantProductionSyncResult> {
  const payload = {
    action: "sync_production_data" as const,
    availability_entities: normalizeEntityList(input.availabilityEntities),
    batch_id: input.batchId ?? null,
    dry_run: input.dryRun ?? false,
    entity_links: normalizeEntityLinks(input.entityLinks),
    equipment_id: input.equipmentId ?? null,
    include_all_numeric_sensors: input.includeAllNumericSensors ?? false,
    location_id: input.locationId ?? null,
    mapping_profile: normalizeMappingProfileContext(input.mappingProfile),
    max_entities: input.maxEntities,
    persist_availability: input.persistAvailability ?? true,
    sensor_entities: normalizeEntityList(input.sensorEntities),
    source: input.source ?? "homeassistant",
    thresholds: normalizeThresholds(input.thresholds),
  };

  const { data, error } = await aisha.functions.invoke("homeassistant-api", {
    body: payload,
  });

  if (error) {
    safeError("homeAssistant.sync.invokeFailed", error);
    throw new Error(error.message);
  }

  const parsed = homeAssistantSyncSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Home Assistant sync response is invalid");
  }

  return parsed.data;
}
