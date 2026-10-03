import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { getHomeAssistantConfig } from '../lib/ha-config.js';
import { fetchHaStates, readNonEmptyString, isRecord } from '../lib/ha-client.js';
import type {
  HomeAssistantState,
  ExcursionThreshold,
  EntityLink,
  MappingProfileContext,
  SkippedEntity,
  SyncRunInfo,
} from '../lib/ha-config.js';

// ── Constants ──

const HOME_ASSISTANT_SOURCE_ALLOWED = new Set([
  'homeassistant', 'manual', 'plc', 'lims', 'iot_gateway', 'scada',
]);

const TRUE_STATES = new Set([
  'on', 'home', 'open', 'available', 'online', 'true', '1', 'connected', 'detected', 'active',
]);

const FALSE_STATES = new Set([
  'off', 'not_home', 'closed', 'unavailable', 'unknown', 'false', '0', 'disconnected', 'idle', 'inactive',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SOURCE = 'homeassistant';

// ── Types ──

export interface SyncRequestBody {
  action?: string;
  availability_entities?: string[];
  batch_id?: string | null;
  dry_run?: boolean;
  entity_links?: Record<string, EntityLink>;
  equipment_id?: string | null;
  include_all_numeric_sensors?: boolean;
  location_id?: string | null;
  mapping_profile?: MappingProfileContext;
  max_entities?: number;
  persist_availability?: boolean;
  sensor_entities?: string[];
  source?: string;
  thresholds?: Record<string, ExcursionThreshold>;
}

// ── Parse helpers ──

function parseEntityList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const unique = new Set<string>();
  for (const item of value) {
    const entityId = readNonEmptyString(item);
    if (entityId) unique.add(entityId);
  }
  return Array.from(unique);
}

function parseOptionalUuid(value: unknown): string | null {
  const parsed = readNonEmptyString(value);
  if (!parsed) return null;
  return UUID_REGEX.test(parsed) ? parsed : null;
}

function parseThresholdMap(value: unknown): Record<string, ExcursionThreshold> {
  if (!isRecord(value)) return {};
  const result: Record<string, ExcursionThreshold> = {};
  for (const [entityId, cfg] of Object.entries(value)) {
    if (!isRecord(cfg)) continue;
    const min = typeof cfg.min === 'number' && Number.isFinite(cfg.min) ? cfg.min : undefined;
    const max = typeof cfg.max === 'number' && Number.isFinite(cfg.max) ? cfg.max : undefined;
    const warnMarginPct = typeof cfg.warn_margin_pct === 'number' && Number.isFinite(cfg.warn_margin_pct) && cfg.warn_margin_pct >= 0
      ? cfg.warn_margin_pct : undefined;
    result[entityId] = { max, min, warn_margin_pct: warnMarginPct };
  }
  return result;
}

function parseEntityLinks(value: unknown): Record<string, EntityLink> {
  if (!isRecord(value)) return {};
  const result: Record<string, EntityLink> = {};
  for (const [entityId, rawLink] of Object.entries(value)) {
    if (!isRecord(rawLink)) continue;
    const trimmed = entityId.trim();
    if (!trimmed) continue;
    const equipmentId = parseOptionalUuid(rawLink.equipment_id);
    const locationId = parseOptionalUuid(rawLink.location_id);
    const readingType = readNonEmptyString(rawLink.reading_type);
    const sensorCode = readNonEmptyString(rawLink.sensor_code);
    const unit = readNonEmptyString(rawLink.unit);
    if (!equipmentId && !locationId && !readingType && !sensorCode && !unit) continue;
    result[trimmed] = {
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      ...(locationId ? { location_id: locationId } : {}),
      ...(readingType ? { reading_type: readingType } : {}),
      ...(sensorCode ? { sensor_code: sensorCode } : {}),
      ...(unit ? { unit } : {}),
    };
  }
  return result;
}

function parseMappingProfile(value: unknown): MappingProfileContext | null {
  if (!isRecord(value)) return null;
  const flowNodeId = parseOptionalUuid(value.flow_node_id);
  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);
  if (!flowNodeId && !id && !name) return null;
  return {
    ...(flowNodeId ? { flow_node_id: flowNodeId } : {}),
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

function normalizeSource(value: unknown): string | null {
  const parsed = readNonEmptyString(value)?.toLowerCase() ?? null;
  if (!parsed) return DEFAULT_SOURCE;
  if (!HOME_ASSISTANT_SOURCE_ALLOWED.has(parsed)) return null;
  return parsed;
}

function parseEntityLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return config.defaultEntityLimit;
  if (value <= 0) return config.defaultEntityLimit;
  return Math.min(Math.floor(value), config.maxEntityLimit);
}

function parseNumericState(rawState: string): number | null {
  const normalized = rawState.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAvailabilityState(rawState: string): boolean | null {
  const normalized = rawState.trim().toLowerCase();
  if (TRUE_STATES.has(normalized)) return true;
  if (FALSE_STATES.has(normalized)) return false;
  return null;
}

function inferReadingType(params: { deviceClass: unknown; entityId: string; unit: unknown }): string {
  const rawDeviceClass = readNonEmptyString(params.deviceClass)?.toLowerCase();
  const entityId = params.entityId.toLowerCase();
  const unit = readNonEmptyString(params.unit)?.toLowerCase() ?? '';

  if (rawDeviceClass === 'temperature' || unit.includes('°c')) return 'temperature';
  if (rawDeviceClass === 'humidity' || unit.includes('%')) return 'humidity';
  if (rawDeviceClass === 'pressure' || unit.includes('hpa')) return 'pressure';
  if (rawDeviceClass === 'carbon_dioxide' || entityId.includes('co2') || unit.includes('ppm')) return 'co2';
  if (rawDeviceClass === 'weight' || unit.includes('kg') || unit.includes('g')) return 'weight';
  if (rawDeviceClass === 'power' || rawDeviceClass === 'current' || unit.includes('w') || unit.includes('kw')) return 'power';
  if (rawDeviceClass === 'duration' || unit.includes('min') || unit.includes('h')) return 'duration';
  if (entityId.includes('ph')) return 'ph';
  if (entityId.includes('flow')) return 'flow_rate';
  if (entityId.includes('conduct')) return 'conductivity';
  if (entityId.includes('oxygen')) return 'dissolved_oxygen';
  return 'custom';
}

function evaluateExcursion(value: number, threshold: ExcursionThreshold | undefined): {
  excursionSeverity: string | null;
  isExcursion: boolean;
} {
  if (!threshold) return { excursionSeverity: null, isExcursion: false };
  const { min, max, warn_margin_pct } = threshold;
  const warnMarginPct = warn_margin_pct ?? 0;

  if (typeof min === 'number' && value < min) return { excursionSeverity: 'critical', isExcursion: true };
  if (typeof max === 'number' && value > max) return { excursionSeverity: 'critical', isExcursion: true };
  if (warnMarginPct <= 0) return { excursionSeverity: null, isExcursion: false };

  const inferredRange = typeof min === 'number' && typeof max === 'number' && max > min
    ? max - min
    : Math.max(Math.abs(min ?? 0), Math.abs(max ?? 0), 1);
  const warningMargin = inferredRange * (warnMarginPct / 100);

  if (typeof min === 'number' && value <= min + warningMargin) return { excursionSeverity: 'warning', isExcursion: true };
  if (typeof max === 'number' && value >= max - warningMargin) return { excursionSeverity: 'warning', isExcursion: true };
  return { excursionSeverity: null, isExcursion: false };
}

function stateToTimestamp(state: HomeAssistantState): string {
  return readNonEmptyString(state.last_updated) ?? readNonEmptyString(state.last_changed) ?? new Date().toISOString();
}

// ── Audit helper ──

async function writeSyncRunAuditLog(userId: string, input: Record<string, unknown>): Promise<string | null> {
  try {
    const data = await rpcService<string | null>('write_audit_journal', {
      p_action_type: 'create',
      p_area: 'products',
      p_details: input,
      p_entity_id: (input.sync_run as Record<string, unknown>)?.id ?? null,
      p_entity_type: 'homeassistant_sync_run',
      p_new_values: null,
      p_old_values: null,
      p_severity: (input.metrics as Record<string, unknown>)?.skipped_count ? 'warning' : 'info',
      p_summary: (input.dry_run as boolean) ? 'Home Assistant production sync dry-run completed' : 'Home Assistant production sync completed',
      p_tags: ['admin', 'homeassistant', 'production_sync', (input.dry_run as boolean) ? 'dry_run' : 'persisted'],
      p_user_id: userId,
    });
    return readNonEmptyString(data);
  } catch {
    return null;
  }
}

// ── Handler ──

/**
 * Core Home Assistant production-sync handler.
 *
 * Extracted from the /ha/sync route so the same logic can be invoked
 * directly by the action-dispatching /homeassistant-api route without
 * duplicating auth, config-loading, entity processing, or response
 * shaping. Preserves the exact auth checks and response shapes of the
 * original handler. Reads sync fields from `req.body`; any `action`
 * discriminator supplied by the dispatcher is ignored here.
 */
export async function handleHaSync(
  req: FastifyRequest<{ Body: SyncRequestBody }>,
  reply: FastifyReply,
): Promise<FastifyReply> {
    // Auth
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: err instanceof Error ? err.message : 'Unauthorized' });
    }

    if (!isAdminOrStaff(user)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const haConfig = await getHomeAssistantConfig();
    if (!haConfig) {
      return reply.status(400).send({
        error: 'Home Assistant is not configured. Set homeassistant_base_url and homeassistant_access_token.',
      });
    }

    const body = req.body ?? {} as SyncRequestBody;
    const source = normalizeSource(body.source);
    if (!source) {
      return reply.status(400).send({ error: 'Invalid source value' });
    }

    const syncRunStart = new Date();
    const syncRunId = crypto.randomUUID();
    const batchId = parseOptionalUuid(body.batch_id);
    const equipmentId = parseOptionalUuid(body.equipment_id);
    const locationId = parseOptionalUuid(body.location_id);
    const dryRun = body.dry_run === true;
    const persistAvailability = body.persist_availability !== false;
    const includeAllNumericSensors = body.include_all_numeric_sensors === true;
    const maxEntities = parseEntityLimit(body.max_entities);
    const sensorEntities = parseEntityList(body.sensor_entities);
    const availabilityEntities = parseEntityList(body.availability_entities);
    const thresholds = parseThresholdMap(body.thresholds);
    const entityLinks = parseEntityLinks(body.entity_links);
    const mappingProfile = parseMappingProfile(body.mapping_profile);

    if (sensorEntities.length === 0 && availabilityEntities.length === 0 && !includeAllNumericSensors) {
      return reply.status(400).send({
        error: 'No entities configured. Provide sensor_entities or availability_entities.',
      });
    }

    // Fetch states from HA
    let stateSnapshot;
    try {
      stateSnapshot = await fetchHaStates(haConfig);
    } catch {
      return reply.status(502).send({ error: 'Failed to fetch states from Home Assistant' });
    }

    const statesByEntity = new Map<string, HomeAssistantState>();
    for (const state of stateSnapshot.states) {
      statesByEntity.set(state.entity_id, state);
    }

    // Dynamic numeric sensor discovery
    const dynamicNumericSensors = includeAllNumericSensors
      ? stateSnapshot.states
          .filter((s) => s.entity_id.startsWith('sensor.'))
          .filter((s) => parseNumericState(s.state) !== null)
          .map((s) => s.entity_id)
      : [];

    const selectedSensorEntities = Array.from(
      new Set([...sensorEntities, ...dynamicNumericSensors]),
    ).slice(0, maxEntities);
    const selectedAvailabilityEntities = availabilityEntities.slice(0, maxEntities);

    const skippedSensors: SkippedEntity[] = [];
    const skippedAvailability: SkippedEntity[] = [];
    const insertedSensorIds: string[] = [];
    const insertedAvailabilityIds: string[] = [];
    const appliedLinkEntities = new Set<string>();

    let importedSensorCount = 0;
    let importedAvailabilityCount = 0;
    let availabilityOnlineCount = 0;

    // ── Process sensor entities ──
    for (const entityId of selectedSensorEntities) {
      const state = statesByEntity.get(entityId);
      if (!state) { skippedSensors.push({ entity_id: entityId, reason: 'missing_state' }); continue; }

      const numericValue = parseNumericState(state.state);
      if (numericValue === null) { skippedSensors.push({ entity_id: entityId, reason: 'non_numeric_state' }); continue; }

      const entityLink = entityLinks[entityId];
      if (entityLink) appliedLinkEntities.add(entityId);

      const unit = entityLink?.unit ?? readNonEmptyString(state.attributes.unit_of_measurement) ?? 'unitless';
      const readingType = entityLink?.reading_type ?? inferReadingType({ deviceClass: state.attributes.device_class, entityId: state.entity_id, unit });
      const sensorCode = entityLink?.sensor_code ?? state.entity_id;
      const entityEquipmentId = entityLink?.equipment_id ?? equipmentId;
      const entityLocationId = entityLink?.location_id ?? locationId;
      const recordedAt = stateToTimestamp(state);
      const excursion = evaluateExcursion(numericValue, thresholds[entityId]);

      const metadata = {
        mapping_profile: mappingProfile,
        homeassistant: {
          device_class: readNonEmptyString(state.attributes.device_class),
          entity_id: state.entity_id,
          friendly_name: readNonEmptyString(state.attributes.friendly_name),
          last_changed: state.last_changed,
          last_updated: state.last_updated,
          state_class: readNonEmptyString(state.attributes.state_class),
        },
        entity_link: entityLink ?? null,
        integration: 'homeassistant-api',
        raw_state: state.state,
        sync_run: { id: syncRunId, started_at: syncRunStart.toISOString() },
        synced_at: new Date().toISOString(),
      };

      if (!dryRun) {
        try {
          const data = await rpcService<string | null>('create_production_sensor_reading_admin', {
            p_batch_id: batchId,
            p_equipment_id: entityEquipmentId,
            p_excursion_severity: excursion.excursionSeverity,
            p_flow_node_id: mappingProfile?.flow_node_id ?? null,
            p_is_excursion: excursion.isExcursion,
            p_location_id: entityLocationId,
            p_metadata: metadata,
            p_reading_type: readingType,
            p_recorded_at: recordedAt,
            p_sensor_code: sensorCode,
            p_source: source,
            p_unit: unit,
            p_value: numericValue,
          });
          const insertedId = readNonEmptyString(data);
          if (insertedId) insertedSensorIds.push(insertedId);
        } catch {
          skippedSensors.push({ entity_id: entityId, reason: 'rpc_error' });
          continue;
        }
      }

      importedSensorCount += 1;
    }

    // ── Process availability entities ──
    for (const entityId of selectedAvailabilityEntities) {
      const state = statesByEntity.get(entityId);
      if (!state) { skippedAvailability.push({ entity_id: entityId, reason: 'missing_state' }); continue; }

      const availabilityValue = parseAvailabilityState(state.state);
      if (availabilityValue === null) { skippedAvailability.push({ entity_id: entityId, reason: 'non_boolean_state' }); continue; }

      const entityLink = entityLinks[entityId];
      if (entityLink) appliedLinkEntities.add(entityId);

      const sensorCode = entityLink?.sensor_code ?? state.entity_id;
      const readingType = entityLink?.reading_type ?? 'custom';
      const unit = entityLink?.unit ?? 'boolean';
      const entityEquipmentId = entityLink?.equipment_id ?? equipmentId;
      const entityLocationId = entityLink?.location_id ?? locationId;

      if (availabilityValue) availabilityOnlineCount += 1;

      if (persistAvailability && !dryRun) {
        const metadata = {
          mapping_profile: mappingProfile,
          homeassistant: {
            device_class: readNonEmptyString(state.attributes.device_class),
            entity_id: state.entity_id,
            friendly_name: readNonEmptyString(state.attributes.friendly_name),
            metric_kind: 'availability',
          },
          entity_link: entityLink ?? null,
          integration: 'homeassistant-api',
          raw_state: state.state,
          sync_run: { id: syncRunId, started_at: syncRunStart.toISOString() },
          synced_at: new Date().toISOString(),
        };

        try {
          const data = await rpcService<string | null>('create_production_sensor_reading_admin', {
            p_batch_id: batchId,
            p_equipment_id: entityEquipmentId,
            p_excursion_severity: availabilityValue ? null : 'warning',
            p_flow_node_id: mappingProfile?.flow_node_id ?? null,
            p_is_excursion: !availabilityValue,
            p_location_id: entityLocationId,
            p_metadata: metadata,
            p_reading_type: readingType,
            p_recorded_at: stateToTimestamp(state),
            p_sensor_code: sensorCode,
            p_source: source,
            p_unit: unit,
            p_value: availabilityValue ? 1 : 0,
          });
          const insertedId = readNonEmptyString(data);
          if (insertedId) insertedAvailabilityIds.push(insertedId);
        } catch {
          skippedAvailability.push({ entity_id: entityId, reason: 'rpc_error' });
          continue;
        }
      }

      importedAvailabilityCount += 1;
    }

    // ── Summary ──
    const availabilityTotal = selectedAvailabilityEntities.length - skippedAvailability.length;
    const availabilityRate = availabilityTotal > 0
      ? Math.round((availabilityOnlineCount / availabilityTotal) * 10000) / 100
      : null;

    const syncRunCompletedAt = new Date();
    const syncRunInfo: SyncRunInfo = {
      audit_journal_id: null,
      completed_at: syncRunCompletedAt.toISOString(),
      duration_ms: syncRunCompletedAt.getTime() - syncRunStart.getTime(),
      id: syncRunId,
      started_at: syncRunStart.toISOString(),
    };

    const auditId = await writeSyncRunAuditLog(user.userId, {
      configuration: {
        include_all_numeric_sensors: includeAllNumericSensors,
        max_entities: maxEntities,
        persist_availability: persistAvailability,
        source,
      },
      context: { batch_id: batchId, equipment_id: equipmentId, location_id: locationId, mapping_profile: mappingProfile },
      metrics: {
        availability: {
          online_count: availabilityOnlineCount,
          online_rate_pct: availabilityRate,
          processed_count: importedAvailabilityCount,
          requested_count: selectedAvailabilityEntities.length,
          skipped_count: skippedAvailability.length,
        },
        sensors: {
          processed_count: importedSensorCount,
          requested_count: selectedSensorEntities.length,
          skipped_count: skippedSensors.length,
        },
        links: { applied_count: appliedLinkEntities.size, configured_count: Object.keys(entityLinks).length },
        states_fetched: stateSnapshot.states.length,
        transport: stateSnapshot.transport,
      },
      sync_run: {
        completed_at: syncRunInfo.completed_at,
        dry_run: dryRun,
        duration_ms: syncRunInfo.duration_ms,
        id: syncRunInfo.id,
        started_at: syncRunInfo.started_at,
      },
      dry_run: dryRun,
    });

    if (auditId) syncRunInfo.audit_journal_id = auditId;

    return reply.send({
      dry_run: dryRun,
      ha_version: stateSnapshot.haVersion,
      success: true,
      summary: {
        availability: {
          online_count: availabilityOnlineCount,
          online_rate_pct: availabilityRate,
          processed_count: importedAvailabilityCount,
          requested_count: selectedAvailabilityEntities.length,
          skipped_count: skippedAvailability.length,
        },
        sensors: {
          processed_count: importedSensorCount,
          requested_count: selectedSensorEntities.length,
          skipped_count: skippedSensors.length,
        },
        links: {
          applied_count: appliedLinkEntities.size,
          configured_count: Object.keys(entityLinks).length,
        },
        states_fetched: stateSnapshot.states.length,
        transport: stateSnapshot.transport,
      },
      ...(dryRun ? {} : {
        inserted_ids: { availability: insertedAvailabilityIds, sensors: insertedSensorIds },
      }),
      skipped: { availability: skippedAvailability, sensors: skippedSensors },
      sync_run: syncRunInfo,
    });
}

// ── Route ──

export async function syncRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncRequestBody }>('/ha/sync', handleHaSync);
}
