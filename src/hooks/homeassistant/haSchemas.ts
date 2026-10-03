import { z } from "zod";

export const HOME_ASSISTANT_SYNC_PROFILE_KEY = "homeassistant_production_sync_profile";
export const HOME_ASSISTANT_SYNC_PROFILE_STORE_VERSION = 1;
export const HOME_ASSISTANT_DEFAULT_PROFILE_ID = "default";

export const homeAssistantSyncSourceSchema = z.enum([
  "homeassistant",
  "manual",
  "plc",
  "lims",
  "iot_gateway",
  "scada",
]);

export const homeAssistantHealthSchema = z.object({
  config: z
    .object({
      location_name: z.string().nullable().optional(),
      time_zone: z.string().nullable().optional(),
      unit_system: z.unknown().nullable().optional(),
    })
    .optional(),
  ha_version: z.string().nullable().optional(),
  success: z.boolean(),
  transport: z.enum(["websocket", "rest"]).optional(),
});

export const skippedEntitySchema = z.object({
  entity_id: z.string(),
  reason: z.enum([
    "missing_state",
    "non_numeric_state",
    "non_boolean_state",
    "rpc_error",
  ]),
});

export const homeAssistantSyncSchema = z.object({
  dry_run: z.boolean(),
  ha_version: z.string().nullable().optional(),
  inserted_ids: z
    .object({
      availability: z.array(z.string()),
      sensors: z.array(z.string()),
    })
    .optional(),
  skipped: z.object({
    availability: z.array(skippedEntitySchema),
    sensors: z.array(skippedEntitySchema),
  }),
  sync_run: z
    .object({
      audit_journal_id: z.string().nullable(),
      completed_at: z.string(),
      duration_ms: z.number().int().nonnegative(),
      id: z.string(),
      started_at: z.string(),
    })
    .optional(),
  success: z.boolean(),
  summary: z.object({
    availability: z.object({
      online_count: z.number(),
      online_rate_pct: z.number().nullable(),
      processed_count: z.number(),
      requested_count: z.number(),
      skipped_count: z.number(),
    }),
    links: z
      .object({
        applied_count: z.number(),
        configured_count: z.number(),
      })
      .optional(),
    sensors: z.object({
      processed_count: z.number(),
      requested_count: z.number(),
      skipped_count: z.number(),
    }),
    states_fetched: z.number(),
    transport: z.enum(["websocket", "rest"]),
  }),
});

export const homeAssistantEntityLinkSchema = z.object({
  equipmentId: z.string().optional(),
  locationId: z.string().optional(),
  readingType: z.string().optional(),
  sensorCode: z.string().optional(),
  unit: z.string().optional(),
});

export const homeAssistantSyncProfileSchema = z.object({
  availabilityEntities: z.array(z.string()),
  batchId: z.string().nullable(),
  dryRun: z.boolean(),
  entityLinks: z.record(z.string(), homeAssistantEntityLinkSchema),
  equipmentId: z.string().nullable(),
  includeAllNumericSensors: z.boolean(),
  locationId: z.string().nullable(),
  sensorEntities: z.array(z.string()),
  source: homeAssistantSyncSourceSchema,
});

export const homeAssistantSyncProfileTemplateSchema = z.object({
  config: homeAssistantSyncProfileSchema,
  description: z.string().nullable(),
  flowNodeId: z.string().nullable(),
  id: z.string().min(1),
  name: z.string().min(1),
  updatedAt: z.string(),
});

export const homeAssistantSyncProfileStoreSchema = z.object({
  activeProfileId: z.string().nullable(),
  profiles: z.array(homeAssistantSyncProfileTemplateSchema),
  version: z.number().int().positive(),
});

export const homeAssistantSyncProfileStoreSnapshotSchema = z.object({
  store: homeAssistantSyncProfileStoreSchema,
  updatedAt: z.string().nullable(),
});

/**
 * Parsed response shape for Home Assistant connectivity checks.
 */
export type HomeAssistantHealth = z.infer<typeof homeAssistantHealthSchema>;
/**
 * Parsed response shape for production data synchronization.
 */
export type HomeAssistantProductionSyncResult = z.infer<typeof homeAssistantSyncSchema>;
/**
 * Parsed persisted sync profile for Home Assistant production integration.
 */
export type HomeAssistantProductionSyncProfile = z.infer<typeof homeAssistantSyncProfileSchema>;
/**
 * Stored named sync profile template for assigning devices to specific production contexts.
 */
export type HomeAssistantSyncProfileTemplate = z.infer<typeof homeAssistantSyncProfileTemplateSchema>;
/**
 * Collection of named sync profiles with currently active profile id.
 */
export type HomeAssistantSyncProfileStore = z.infer<typeof homeAssistantSyncProfileStoreSchema>;
/**
 * Persisted profile store with last update timestamp used for CAS writes.
 */
export type HomeAssistantSyncProfileStoreSnapshot =
  z.infer<typeof homeAssistantSyncProfileStoreSnapshotSchema>;

/**
 * Optional excursion thresholds for a specific Home Assistant entity.
 */
export interface HomeAssistantThreshold {
  max?: number;
  min?: number;
  warnMarginPct?: number;
}

/**
 * Optional per-entity mapping overrides used during Home Assistant sync.
 */
export interface HomeAssistantEntityLink {
  equipmentId?: string;
  locationId?: string;
  readingType?: string;
  sensorCode?: string;
  unit?: string;
}

/**
 * Input payload for syncing Home Assistant telemetry to production sensor readings.
 */
export interface HomeAssistantProductionSyncInput {
  availabilityEntities?: string[];
  batchId?: string;
  dryRun?: boolean;
  entityLinks?: Record<string, HomeAssistantEntityLink>;
  equipmentId?: string;
  includeAllNumericSensors?: boolean;
  locationId?: string;
  maxEntities?: number;
  mappingProfile?: {
    flowNodeId?: string;
    id?: string;
    name?: string;
  };
  persistAvailability?: boolean;
  sensorEntities?: string[];
  source?: z.infer<typeof homeAssistantSyncSourceSchema>;
  thresholds?: Record<string, HomeAssistantThreshold>;
}

/**
 * Input payload for persisting profile store with optional optimistic-lock timestamp.
 */
export interface SaveHomeAssistantSyncProfileStoreInput {
  expectedUpdatedAt?: string | null;
  store: HomeAssistantSyncProfileStore;
}
