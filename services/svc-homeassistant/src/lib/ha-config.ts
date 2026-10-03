import { rpcService } from '../postgrest.js';

export interface HomeAssistantConfig {
  accessToken: string;
  baseUrl: string;
}

/**
 * Fetch Home Assistant config (base URL + long-lived access token) from app_secrets.
 */
export async function getHomeAssistantConfig(): Promise<HomeAssistantConfig | null> {
  try {
    const data = await rpcService<{ rows?: Array<{ key?: unknown; value?: unknown }> } | null>(
      'edge_app_secrets',
      { p_action: 'get_many', p_payload: { keys: ['homeassistant_base_url', 'homeassistant_access_token'] } },
    );

    const rows = data?.rows ?? [];
    let baseUrl: string | null = null;
    let accessToken: string | null = null;

    for (const row of rows) {
      if (row.key === 'homeassistant_base_url' && typeof row.value === 'string') {
        baseUrl = row.value;
      }
      if (row.key === 'homeassistant_access_token' && typeof row.value === 'string') {
        accessToken = row.value;
      }
    }

    if (!baseUrl || !accessToken) return null;

    return { baseUrl, accessToken };
  } catch {
    return null;
  }
}

// ── State types ──

export interface HomeAssistantState {
  attributes: Record<string, unknown>;
  entity_id: string;
  last_changed: string | null;
  last_updated: string | null;
  state: string;
}

export interface ExcursionThreshold {
  max?: number;
  min?: number;
  warn_margin_pct?: number;
}

export interface EntityLink {
  equipment_id?: string;
  location_id?: string;
  reading_type?: string;
  sensor_code?: string;
  unit?: string;
}

export interface MappingProfileContext {
  flow_node_id?: string;
  id?: string;
  name?: string;
}

export interface SkippedEntity {
  entity_id: string;
  reason: 'missing_state' | 'non_numeric_state' | 'non_boolean_state' | 'rpc_error';
}

export interface SyncRunInfo {
  audit_journal_id: string | null;
  completed_at: string;
  duration_ms: number;
  id: string;
  started_at: string;
}
