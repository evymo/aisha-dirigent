import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";
import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  bearerTokenGuard,
  corsGuard,
  methodGuard,
} from "../_shared/analyzeTrackingDocumentGuards.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import {
  getHomeAssistantConfig,
  type HomeAssistantConfig,
} from "../_shared/homeAssistantKeys.ts";

type HomeAssistantAction = "health" | "sync_production_data";
type HomeAssistantTransport = "websocket" | "rest";

interface HomeAssistantState {
  attributes: Record<string, unknown>;
  entity_id: string;
  last_changed: string | null;
  last_updated: string | null;
  state: string;
}

interface ExcursionThreshold {
  max?: number;
  min?: number;
  warn_margin_pct?: number;
}

interface EntityLink {
  equipment_id?: string;
  location_id?: string;
  reading_type?: string;
  sensor_code?: string;
  unit?: string;
}

interface MappingProfileContext {
  flow_node_id?: string;
  id?: string;
  name?: string;
}

interface SyncRequestBody {
  action?: HomeAssistantAction;
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

interface WebSocketCommandResult {
  haVersion: string | null;
  result: unknown;
}

interface WebSocketEnvelope {
  id?: unknown;
  result?: unknown;
  success?: unknown;
  type?: unknown;
}

interface SkippedEntity {
  entity_id: string;
  reason:
    | "missing_state"
    | "non_numeric_state"
    | "non_boolean_state"
    | "rpc_error";
}

interface SyncRunInfo {
  audit_journal_id: string | null;
  completed_at: string;
  duration_ms: number;
  id: string;
  started_at: string;
}

interface SyncRunAuditInput {
  availabilityOnlineCount: number;
  availabilityProcessedCount: number;
  availabilityRatePct: number | null;
  availabilityRequestedCount: number;
  availabilitySkippedCount: number;
  batchId: string | null;
  dryRun: boolean;
  equipmentId: string | null;
  includeAllNumericSensors: boolean;
  linksAppliedCount: number;
  linksConfiguredCount: number;
  locationId: string | null;
  mappingProfile: MappingProfileContext | null;
  maxEntities: number;
  persistAvailability: boolean;
  sensorProcessedCount: number;
  sensorRequestedCount: number;
  sensorSkippedCount: number;
  source: string;
  statesFetched: number;
  syncRun: SyncRunInfo;
  transport: HomeAssistantTransport;
  userId: string;
}

const HOME_ASSISTANT_SOURCE_ALLOWED = new Set([
  "homeassistant",
  "manual",
  "plc",
  "lims",
  "iot_gateway",
  "scada",
]);

const HOME_ASSISTANT_TRUE_STATES = new Set([
  "on",
  "home",
  "open",
  "available",
  "online",
  "true",
  "1",
  "connected",
  "detected",
  "active",
]);

const HOME_ASSISTANT_FALSE_STATES = new Set([
  "off",
  "not_home",
  "closed",
  "unavailable",
  "unknown",
  "false",
  "0",
  "disconnected",
  "idle",
  "inactive",
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_ENTITY_LIMIT = 1000;
const DEFAULT_ENTITY_LIMIT = 250;
const HOME_ASSISTANT_TIMEOUT_MS = 15000;
const DEFAULT_HOME_ASSISTANT_SOURCE = "homeassistant";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(request, allowedOriginsRaw, body, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEntityList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const unique = new Set<string>();
  for (const item of value) {
    const entityId = readNonEmptyString(item);
    if (!entityId) continue;
    unique.add(entityId);
  }
  return Array.from(unique);
}

function parseThresholdMap(
  value: unknown,
): Record<string, ExcursionThreshold> {
  if (!isRecord(value)) return {};

  const result: Record<string, ExcursionThreshold> = {};
  for (const [entityId, config] of Object.entries(value)) {
    if (!isRecord(config)) continue;

    const min =
      typeof config.min === "number" && Number.isFinite(config.min)
        ? config.min
        : undefined;
    const max =
      typeof config.max === "number" && Number.isFinite(config.max)
        ? config.max
        : undefined;
    const warnMarginPct =
      typeof config.warn_margin_pct === "number" &&
        Number.isFinite(config.warn_margin_pct) &&
        config.warn_margin_pct >= 0
        ? config.warn_margin_pct
        : undefined;

    result[entityId] = {
      max,
      min,
      warn_margin_pct: warnMarginPct,
    };
  }

  return result;
}

function parseOptionalUuid(value: unknown): string | null {
  const parsed = readNonEmptyString(value);
  if (!parsed) return null;
  return UUID_REGEX.test(parsed) ? parsed : null;
}

function parseEntityLinks(value: unknown): Record<string, EntityLink> {
  if (!isRecord(value)) return {};

  const result: Record<string, EntityLink> = {};
  for (const [entityId, rawLink] of Object.entries(value)) {
    if (!isRecord(rawLink)) continue;

    const trimmedEntityId = entityId.trim();
    if (trimmedEntityId.length === 0) continue;

    const equipmentId = parseOptionalUuid(rawLink.equipment_id);
    const locationId = parseOptionalUuid(rawLink.location_id);
    const readingType = readNonEmptyString(rawLink.reading_type);
    const sensorCode = readNonEmptyString(rawLink.sensor_code);
    const unit = readNonEmptyString(rawLink.unit);

    if (
      !equipmentId &&
      !locationId &&
      !readingType &&
      !sensorCode &&
      !unit
    ) {
      continue;
    }

    result[trimmedEntityId] = {
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      ...(locationId ? { location_id: locationId } : {}),
      ...(readingType ? { reading_type: readingType } : {}),
      ...(sensorCode ? { sensor_code: sensorCode } : {}),
      ...(unit ? { unit } : {}),
    };
  }

  return result;
}

function parseMappingProfileContext(
  value: unknown,
): MappingProfileContext | null {
  if (!isRecord(value)) return null;

  const flowNodeId = parseOptionalUuid(value.flow_node_id);
  const id = readNonEmptyString(value.id);
  const name = readNonEmptyString(value.name);

  if (!flowNodeId && !id && !name) {
    return null;
  }

  return {
    ...(flowNodeId ? { flow_node_id: flowNodeId } : {}),
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  };
}

function normalizeSource(value: unknown): string | null {
  const parsed = readNonEmptyString(value)?.toLowerCase() ?? null;
  if (!parsed) return DEFAULT_HOME_ASSISTANT_SOURCE;
  if (!HOME_ASSISTANT_SOURCE_ALLOWED.has(parsed)) return null;
  return parsed;
}

function parseEntityLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ENTITY_LIMIT;
  }
  if (value <= 0) return DEFAULT_ENTITY_LIMIT;
  return Math.min(Math.floor(value), MAX_ENTITY_LIMIT);
}

function parseAction(value: unknown): HomeAssistantAction {
  if (value === "sync_production_data") return "sync_production_data";
  return "health";
}

function parseNumericState(rawState: string): number | null {
  const normalized = rawState.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAvailabilityState(rawState: string): boolean | null {
  const normalized = rawState.trim().toLowerCase();
  if (HOME_ASSISTANT_TRUE_STATES.has(normalized)) return true;
  if (HOME_ASSISTANT_FALSE_STATES.has(normalized)) return false;
  return null;
}

function inferReadingType(params: {
  deviceClass: unknown;
  entityId: string;
  unit: unknown;
}): string {
  const rawDeviceClass = readNonEmptyString(params.deviceClass)?.toLowerCase();
  const entityId = params.entityId.toLowerCase();
  const unit = readNonEmptyString(params.unit)?.toLowerCase() ?? "";

  if (rawDeviceClass === "temperature" || unit.includes("°c")) {
    return "temperature";
  }
  if (rawDeviceClass === "humidity" || unit.includes("%")) {
    return "humidity";
  }
  if (rawDeviceClass === "pressure" || unit.includes("hpa")) {
    return "pressure";
  }
  if (
    rawDeviceClass === "carbon_dioxide" ||
    entityId.includes("co2") ||
    unit.includes("ppm")
  ) {
    return "co2";
  }
  if (rawDeviceClass === "weight" || unit.includes("kg") || unit.includes("g")) {
    return "weight";
  }
  if (
    rawDeviceClass === "power" ||
    rawDeviceClass === "current" ||
    unit.includes("w") ||
    unit.includes("kw")
  ) {
    return "power";
  }
  if (rawDeviceClass === "duration" || unit.includes("min") || unit.includes("h")) {
    return "duration";
  }
  if (entityId.includes("ph")) {
    return "ph";
  }
  if (entityId.includes("flow")) {
    return "flow_rate";
  }
  if (entityId.includes("conduct")) {
    return "conductivity";
  }
  if (entityId.includes("oxygen")) {
    return "dissolved_oxygen";
  }

  return "custom";
}

function evaluateExcursion(
  value: number,
  threshold: ExcursionThreshold | undefined,
): {
  excursionSeverity: string | null;
  isExcursion: boolean;
} {
  if (!threshold) {
    return { excursionSeverity: null, isExcursion: false };
  }

  const min = threshold.min;
  const max = threshold.max;
  const warnMarginPct = threshold.warn_margin_pct ?? 0;

  if (typeof min === "number" && value < min) {
    return { excursionSeverity: "critical", isExcursion: true };
  }
  if (typeof max === "number" && value > max) {
    return { excursionSeverity: "critical", isExcursion: true };
  }

  if (warnMarginPct <= 0) {
    return { excursionSeverity: null, isExcursion: false };
  }

  const inferredRange =
    typeof min === "number" && typeof max === "number" && max > min
      ? max - min
      : Math.max(Math.abs(min ?? 0), Math.abs(max ?? 0), 1);
  const warningMargin = inferredRange * (warnMarginPct / 100);

  if (typeof min === "number" && value <= min + warningMargin) {
    return { excursionSeverity: "warning", isExcursion: true };
  }
  if (typeof max === "number" && value >= max - warningMargin) {
    return { excursionSeverity: "warning", isExcursion: true };
  }

  return { excursionSeverity: null, isExcursion: false };
}

function stateToTimestamp(state: HomeAssistantState): string {
  return (
    readNonEmptyString(state.last_updated) ??
    readNonEmptyString(state.last_changed) ??
    new Date().toISOString()
  );
}

function normalizeStates(rawStates: unknown): HomeAssistantState[] {
  if (!Array.isArray(rawStates)) return [];
  const result: HomeAssistantState[] = [];

  for (const state of rawStates) {
    if (!isRecord(state)) continue;
    const entityId = readNonEmptyString(state.entity_id);
    const rawState = readNonEmptyString(state.state);
    if (!entityId || rawState === null) continue;

    const attributes = isRecord(state.attributes) ? state.attributes : {};
    const lastChanged = readNonEmptyString(state.last_changed);
    const lastUpdated = readNonEmptyString(state.last_updated);

    result.push({
      attributes,
      entity_id: entityId,
      last_changed: lastChanged,
      last_updated: lastUpdated,
      state: rawState,
    });
  }

  return result;
}

function buildHomeAssistantWebSocketUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/api/websocket`;
  return parsed.toString();
}

async function runHomeAssistantWebSocketCommand(
  config: HomeAssistantConfig,
  commandType: string,
  commandPayload: Record<string, unknown> = {},
): Promise<WebSocketCommandResult> {
  const webSocketUrl = buildHomeAssistantWebSocketUrl(config.baseUrl);

  return await new Promise<WebSocketCommandResult>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const commandId = 1;
    let hasSettled = false;
    let haVersion: string | null = null;

    const settle = (payload: WebSocketCommandResult | null, error?: Error) => {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeoutHandle);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      if (error) {
        reject(error);
        return;
      }
      if (payload) {
        resolve(payload);
      }
    };

    const timeoutHandle = setTimeout(() => {
      settle(
        null,
        new Error("Home Assistant WebSocket command timed out"),
      );
    }, HOME_ASSISTANT_TIMEOUT_MS);

    socket.onerror = () => {
      settle(null, new Error("Home Assistant WebSocket connection failed"));
    };

    socket.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch (err) {
        console.warn("[homeassistant-api] WS frame not valid JSON, dropping:", err);
        return;
      }

      const envelopes = Array.isArray(payload) ? payload : [payload];

      for (const envelopeRaw of envelopes) {
        if (!isRecord(envelopeRaw)) continue;
        const envelope = envelopeRaw as WebSocketEnvelope;
        const type = readNonEmptyString(envelope.type);
        if (!type) continue;

        if (type === "auth_required") {
          haVersion = readNonEmptyString(
            (envelopeRaw as Record<string, unknown>).ha_version,
          );
          socket.send(
            JSON.stringify({
              access_token: config.accessToken,
              type: "auth",
            }),
          );
          continue;
        }

        if (type === "auth_ok") {
          haVersion =
            readNonEmptyString((envelopeRaw as Record<string, unknown>).ha_version) ??
            haVersion;
          socket.send(
            JSON.stringify({
              id: commandId,
              type: commandType,
              ...commandPayload,
            }),
          );
          continue;
        }

        if (type === "auth_invalid") {
          const message =
            readNonEmptyString((envelopeRaw as Record<string, unknown>).message) ??
            "Home Assistant authentication failed";
          settle(null, new Error(message));
          return;
        }

        if (type !== "result") continue;
        if (envelope.id !== commandId) continue;

        if (envelope.success !== true) {
          let errorMessage = "Home Assistant command failed";
          if (isRecord((envelopeRaw as Record<string, unknown>).error)) {
            const errorRecord = (envelopeRaw as Record<string, unknown>)
              .error as Record<string, unknown>;
            errorMessage =
              readNonEmptyString(errorRecord.message) ??
              readNonEmptyString(errorRecord.code) ??
              errorMessage;
          }
          settle(null, new Error(errorMessage));
          return;
        }

        settle({
          haVersion,
          result: envelope.result,
        });
        return;
      }
    };
  });
}

async function callHomeAssistantRest<T>(
  config: HomeAssistantConfig,
  endpoint: string,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${endpoint}`, {
      signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Home Assistant REST error: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchHomeAssistantConfig(
  config: HomeAssistantConfig,
): Promise<{
  config: Record<string, unknown>;
  haVersion: string | null;
  transport: HomeAssistantTransport;
}> {
  try {
    const wsResult = await runHomeAssistantWebSocketCommand(config, "get_config");
    const wsConfig = isRecord(wsResult.result) ? wsResult.result : {};
    return {
      config: wsConfig,
      haVersion:
        readNonEmptyString(wsConfig.version) ??
        readNonEmptyString(wsConfig.ha_version) ??
        wsResult.haVersion,
      transport: "websocket",
    };
  } catch (wsErr) {
    console.warn("[homeassistant-api] WebSocket /config failed, falling back to REST:", wsErr);
    const restConfig = await callHomeAssistantRest<Record<string, unknown>>(
      config,
      "/api/config",
    );
    return {
      config: restConfig,
      haVersion:
        readNonEmptyString(restConfig.version) ??
        readNonEmptyString(restConfig.ha_version),
      transport: "rest",
    };
  }
}

async function fetchHomeAssistantStates(
  config: HomeAssistantConfig,
): Promise<{
  haVersion: string | null;
  states: HomeAssistantState[];
  transport: HomeAssistantTransport;
}> {
  try {
    const wsResult = await runHomeAssistantWebSocketCommand(config, "get_states");
    return {
      haVersion: wsResult.haVersion,
      states: normalizeStates(wsResult.result),
      transport: "websocket",
    };
  } catch (wsErr) {
    console.warn("[homeassistant-api] WebSocket get_states failed, falling back to REST:", wsErr);
    const restStates = await callHomeAssistantRest<unknown[]>(config, "/api/states");
    return {
      haVersion: null,
      states: normalizeStates(restStates),
      transport: "rest",
    };
  }
}

async function isAdminOrStaff(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const [adminResult, staffResult] = await Promise.all([
    supabase.rpc("has_role", { p_role: "admin", p_user_id: userId }),
    supabase.rpc("has_role", { p_role: "staff", p_user_id: userId }),
  ]);

  const isAdmin =
    !adminResult.error && adminResult.data === true;
  const isStaff =
    !staffResult.error && staffResult.data === true;

  return isAdmin || isStaff;
}

async function writeSyncRunAuditLog(
  supabase: SupabaseClient,
  input: SyncRunAuditInput,
): Promise<string | null> {
  const severity =
    input.sensorSkippedCount > 0 || input.availabilitySkippedCount > 0
      ? "warning"
      : "info";
  const summary = input.dryRun
    ? "Home Assistant production sync dry-run completed"
    : "Home Assistant production sync completed";
  const details = {
    configuration: {
      include_all_numeric_sensors: input.includeAllNumericSensors,
      max_entities: input.maxEntities,
      persist_availability: input.persistAvailability,
      source: input.source,
    },
    context: {
      batch_id: input.batchId,
      equipment_id: input.equipmentId,
      location_id: input.locationId,
      mapping_profile: input.mappingProfile,
    },
    metrics: {
      availability: {
        online_count: input.availabilityOnlineCount,
        online_rate_pct: input.availabilityRatePct,
        processed_count: input.availabilityProcessedCount,
        requested_count: input.availabilityRequestedCount,
        skipped_count: input.availabilitySkippedCount,
      },
      links: {
        applied_count: input.linksAppliedCount,
        configured_count: input.linksConfiguredCount,
      },
      sensors: {
        processed_count: input.sensorProcessedCount,
        requested_count: input.sensorRequestedCount,
        skipped_count: input.sensorSkippedCount,
      },
      states_fetched: input.statesFetched,
      transport: input.transport,
    },
    sync_run: {
      completed_at: input.syncRun.completed_at,
      dry_run: input.dryRun,
      duration_ms: input.syncRun.duration_ms,
      id: input.syncRun.id,
      started_at: input.syncRun.started_at,
    },
  };

  const { data, error } = await supabase.rpc("write_audit_journal", {
    p_action_type: "create",
    p_area: "products",
    p_details: details,
    p_entity_id: input.syncRun.id,
    p_entity_type: "homeassistant_sync_run",
    p_new_values: null,
    p_old_values: null,
    p_severity: severity,
    p_summary: summary,
    p_tags: [
      "admin",
      "homeassistant",
      "production_sync",
      input.dryRun ? "dry_run" : "persisted",
    ],
    p_user_id: input.userId,
  });

  if (error) {
    return null;
  }

  return readNonEmptyString(data);
}

serve(async (request) => {
  const originFailure = corsGuard({
    allowedOriginsRaw,
    origin: request.headers.get("Origin"),
  });
  if (originFailure) {
    return silentCorsDenyResponse(originFailure.status);
  }

  if (request.method === "OPTIONS") {
    return preflightResponse(request, allowedOriginsRaw);
  }

  const methodFailure = methodGuard({ method: request.method });
  if (methodFailure) {
    return jsonResponse(request, { error: methodFailure.error }, methodFailure.status);
  }

  const tokenResult = bearerTokenGuard({
    authorizationHeader: request.headers.get("Authorization"),
  });
  if ("status" in tokenResult) {
    return jsonResponse(request, { error: tokenResult.error }, tokenResult.status);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      request,
      { error: "Supabase edge runtime is not configured" },
      500,
    );
  }

  const authorizationHeader = request.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
  });

  // Service-role client for reading secrets from Vault via edge_app_secrets.
  // The main `supabase` client overrides Authorization with the user JWT,
  // which makes PostgREST see `authenticated` role — but edge_app_secrets
  // is only granted to `service_role`. This client keeps the service-role
  // identity intact.
  const serviceRoleClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userResult = await supabase.auth.getUser(tokenResult.token);
  const user = userResult.data.user;
  if (userResult.error || !user) {
    return jsonResponse(request, { error: "Unauthorized" }, 401);
  }

  const hasAccess = await isAdminOrStaff(supabase, user.id);
  if (!hasAccess) {
    return jsonResponse(request, { error: "Forbidden" }, 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    console.warn("[homeassistant-api] request body not valid JSON, defaulting to {}:", err);
    rawBody = {};
  }

  const body = isRecord(rawBody) ? rawBody as SyncRequestBody : {};
  const action = parseAction(body.action);

  const homeAssistantConfig = await getHomeAssistantConfig(serviceRoleClient);
  if (!homeAssistantConfig) {
    return jsonResponse(
      request,
      {
        error:
          "Home Assistant is not configured. Set homeassistant_base_url and homeassistant_access_token.",
      },
      400,
    );
  }

  if (action === "health") {
    try {
      const health = await fetchHomeAssistantConfig(homeAssistantConfig);
      return jsonResponse(request, {
        config: {
          location_name: readNonEmptyString(health.config.location_name),
          time_zone: readNonEmptyString(health.config.time_zone),
          unit_system: isRecord(health.config.unit_system)
            ? health.config.unit_system
            : null,
        },
        ha_version: health.haVersion,
        success: true,
        transport: health.transport,
      });
    } catch {
      return jsonResponse(
        request,
        {
          error: "Failed to connect to Home Assistant",
        },
        502,
      );
    }
  }

  const syncRunStart = new Date();
  const syncRunStartedAt = syncRunStart.toISOString();
  const syncRunId = crypto.randomUUID();
  const source = normalizeSource(body.source);
  if (!source) {
    return jsonResponse(
      request,
      {
        error: "Invalid source value",
      },
      400,
    );
  }

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
  const mappingProfile = parseMappingProfileContext(body.mapping_profile);

  if (
    sensorEntities.length === 0 &&
    availabilityEntities.length === 0 &&
    !includeAllNumericSensors
  ) {
    return jsonResponse(
      request,
      {
        error:
          "No entities configured. Provide sensor_entities or availability_entities.",
      },
      400,
    );
  }

  let stateSnapshot: {
    haVersion: string | null;
    states: HomeAssistantState[];
    transport: HomeAssistantTransport;
  };
  try {
    stateSnapshot = await fetchHomeAssistantStates(homeAssistantConfig);
  } catch {
    return jsonResponse(
      request,
      {
        error: "Failed to fetch states from Home Assistant",
      },
      502,
    );
  }

  const statesByEntity = new Map<string, HomeAssistantState>();
  for (const state of stateSnapshot.states) {
    statesByEntity.set(state.entity_id, state);
  }

  const dynamicNumericSensors = includeAllNumericSensors
    ? stateSnapshot.states
      .filter((state) => state.entity_id.startsWith("sensor."))
      .filter((state) => parseNumericState(state.state) !== null)
      .map((state) => state.entity_id)
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

  for (const entityId of selectedSensorEntities) {
    const state = statesByEntity.get(entityId);
    if (!state) {
      skippedSensors.push({ entity_id: entityId, reason: "missing_state" });
      continue;
    }

    const numericValue = parseNumericState(state.state);
    if (numericValue === null) {
      skippedSensors.push({ entity_id: entityId, reason: "non_numeric_state" });
      continue;
    }

    const entityLink = entityLinks[entityId];
    if (entityLink) {
      appliedLinkEntities.add(entityId);
    }

    const unit =
      entityLink?.unit ??
      readNonEmptyString(state.attributes.unit_of_measurement) ??
      "unitless";
    const readingType =
      entityLink?.reading_type ??
      inferReadingType({
        deviceClass: state.attributes.device_class,
        entityId: state.entity_id,
        unit,
      });
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
      integration: "homeassistant-api",
      raw_state: state.state,
      sync_run: {
        id: syncRunId,
        started_at: syncRunStartedAt,
      },
      synced_at: new Date().toISOString(),
    };

    if (!dryRun) {
      const { data, error } = await supabase.rpc(
        "create_production_sensor_reading_admin",
        {
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
        },
      );

      if (error) {
        skippedSensors.push({ entity_id: entityId, reason: "rpc_error" });
        continue;
      }

      const insertedId = readNonEmptyString(data);
      if (insertedId) {
        insertedSensorIds.push(insertedId);
      }
    }

    importedSensorCount += 1;
  }

  for (const entityId of selectedAvailabilityEntities) {
    const state = statesByEntity.get(entityId);
    if (!state) {
      skippedAvailability.push({ entity_id: entityId, reason: "missing_state" });
      continue;
    }

    const availabilityValue = parseAvailabilityState(state.state);
    if (availabilityValue === null) {
      skippedAvailability.push({
        entity_id: entityId,
        reason: "non_boolean_state",
      });
      continue;
    }

    const entityLink = entityLinks[entityId];
    if (entityLink) {
      appliedLinkEntities.add(entityId);
    }

    const sensorCode = entityLink?.sensor_code ?? state.entity_id;
    const readingType = entityLink?.reading_type ?? "custom";
    const unit = entityLink?.unit ?? "boolean";
    const entityEquipmentId = entityLink?.equipment_id ?? equipmentId;
    const entityLocationId = entityLink?.location_id ?? locationId;

    if (availabilityValue) {
      availabilityOnlineCount += 1;
    }

    if (persistAvailability) {
      const metadata = {
        mapping_profile: mappingProfile,
        homeassistant: {
          device_class: readNonEmptyString(state.attributes.device_class),
          entity_id: state.entity_id,
          friendly_name: readNonEmptyString(state.attributes.friendly_name),
          metric_kind: "availability",
        },
        entity_link: entityLink ?? null,
        integration: "homeassistant-api",
        raw_state: state.state,
        sync_run: {
          id: syncRunId,
          started_at: syncRunStartedAt,
        },
        synced_at: new Date().toISOString(),
      };

      if (!dryRun) {
        const { data, error } = await supabase.rpc(
          "create_production_sensor_reading_admin",
          {
            p_batch_id: batchId,
            p_equipment_id: entityEquipmentId,
            p_excursion_severity: availabilityValue ? null : "warning",
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
          },
        );

        if (error) {
          skippedAvailability.push({ entity_id: entityId, reason: "rpc_error" });
          continue;
        }

        const insertedId = readNonEmptyString(data);
        if (insertedId) {
          insertedAvailabilityIds.push(insertedId);
        }
      }
    }

    importedAvailabilityCount += 1;
  }

  const availabilityTotal =
    selectedAvailabilityEntities.length - skippedAvailability.length;
  const availabilityRate =
    availabilityTotal > 0
      ? Math.round((availabilityOnlineCount / availabilityTotal) * 10000) / 100
      : null;
  const syncRunCompletedAt = new Date();
  const syncRunInfo: SyncRunInfo = {
    audit_journal_id: null,
    completed_at: syncRunCompletedAt.toISOString(),
    duration_ms: syncRunCompletedAt.getTime() - syncRunStart.getTime(),
    id: syncRunId,
    started_at: syncRunStartedAt,
  };
  const syncAuditJournalId = await writeSyncRunAuditLog(supabase, {
    availabilityOnlineCount,
    availabilityProcessedCount: importedAvailabilityCount,
    availabilityRatePct: availabilityRate,
    availabilityRequestedCount: selectedAvailabilityEntities.length,
    availabilitySkippedCount: skippedAvailability.length,
    batchId,
    dryRun,
    equipmentId,
    includeAllNumericSensors,
    linksAppliedCount: appliedLinkEntities.size,
    linksConfiguredCount: Object.keys(entityLinks).length,
    locationId,
    mappingProfile,
    maxEntities,
    persistAvailability,
    sensorProcessedCount: importedSensorCount,
    sensorRequestedCount: selectedSensorEntities.length,
    sensorSkippedCount: skippedSensors.length,
    source,
    statesFetched: stateSnapshot.states.length,
    syncRun: syncRunInfo,
    transport: stateSnapshot.transport,
    userId: user.id,
  });

  if (syncAuditJournalId) {
    syncRunInfo.audit_journal_id = syncAuditJournalId;
  }

  return jsonResponse(request, {
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
    ...(dryRun
      ? {}
      : {
        inserted_ids: {
          availability: insertedAvailabilityIds,
          sensors: insertedSensorIds,
        },
      }),
    skipped: {
      availability: skippedAvailability,
      sensors: skippedSensors,
    },
    sync_run: syncRunInfo,
  });
});
