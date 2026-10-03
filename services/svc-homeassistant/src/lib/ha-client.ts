import WebSocket from 'ws';
import { config } from '../config.js';
import type { HomeAssistantConfig, HomeAssistantState } from './ha-config.js';

// ── Helpers ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStates(rawStates: unknown): HomeAssistantState[] {
  if (!Array.isArray(rawStates)) return [];
  const result: HomeAssistantState[] = [];

  for (const state of rawStates) {
    if (!isRecord(state)) continue;
    const entityId = readNonEmptyString(state.entity_id);
    const rawState = readNonEmptyString(state.state);
    if (!entityId || rawState === null) continue;

    result.push({
      attributes: isRecord(state.attributes) ? state.attributes : {},
      entity_id: entityId,
      last_changed: readNonEmptyString(state.last_changed),
      last_updated: readNonEmptyString(state.last_updated),
      state: rawState,
    });
  }

  return result;
}

function buildWebSocketUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/websocket`;
  return parsed.toString();
}

interface WebSocketCommandResult {
  haVersion: string | null;
  result: unknown;
}

async function runWebSocketCommand(
  haConfig: HomeAssistantConfig,
  commandType: string,
  commandPayload: Record<string, unknown> = {},
): Promise<WebSocketCommandResult> {
  const wsUrl = buildWebSocketUrl(haConfig.baseUrl);

  return await new Promise<WebSocketCommandResult>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const commandId = 1;
    let hasSettled = false;
    let haVersion: string | null = null;

    const settle = (payload: WebSocketCommandResult | null, error?: Error) => {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeoutHandle);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
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
      settle(null, new Error('Home Assistant WebSocket command timed out'));
    }, config.haTimeoutMs);

    socket.onerror = () => {
      settle(null, new Error('Home Assistant WebSocket connection failed'));
    };

    socket.onmessage = (event: { data: unknown }) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const envelopes = Array.isArray(payload) ? payload : [payload];

      for (const envelopeRaw of envelopes) {
        if (!isRecord(envelopeRaw)) continue;
        const type = readNonEmptyString(envelopeRaw.type);
        if (!type) continue;

        if (type === 'auth_required') {
          haVersion = readNonEmptyString(envelopeRaw.ha_version);
          socket.send(JSON.stringify({ access_token: haConfig.accessToken, type: 'auth' }));
          continue;
        }

        if (type === 'auth_ok') {
          haVersion = readNonEmptyString(envelopeRaw.ha_version) ?? haVersion;
          socket.send(JSON.stringify({ id: commandId, type: commandType, ...commandPayload }));
          continue;
        }

        if (type === 'auth_invalid') {
          const message = readNonEmptyString(envelopeRaw.message) ?? 'Home Assistant authentication failed';
          settle(null, new Error(message));
          return;
        }

        if (type !== 'result') continue;
        if (envelopeRaw.id !== commandId) continue;

        if (envelopeRaw.success !== true) {
          let errorMessage = 'Home Assistant command failed';
          if (isRecord(envelopeRaw.error)) {
            const errRecord = envelopeRaw.error as Record<string, unknown>;
            errorMessage = readNonEmptyString(errRecord.message) ?? readNonEmptyString(errRecord.code) ?? errorMessage;
          }
          settle(null, new Error(errorMessage));
          return;
        }

        settle({ haVersion, result: envelopeRaw.result });
        return;
      }
    };
  });
}

async function callRest<T>(haConfig: HomeAssistantConfig, endpoint: string): Promise<T> {
  const response = await fetch(`${haConfig.baseUrl}${endpoint}`, {
    signal: AbortSignal.timeout(config.haTimeoutMs),
    headers: {
      Authorization: `Bearer ${haConfig.accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Home Assistant REST error: ${response.status}`);
  }

  return await response.json() as T;
}

// ── Public API ──

export type HomeAssistantTransport = 'websocket' | 'rest';

export async function fetchHaConfig(haConfig: HomeAssistantConfig): Promise<{
  config: Record<string, unknown>;
  haVersion: string | null;
  transport: HomeAssistantTransport;
}> {
  try {
    const wsResult = await runWebSocketCommand(haConfig, 'get_config');
    const wsConfig = isRecord(wsResult.result) ? wsResult.result : {};
    return {
      config: wsConfig,
      haVersion: readNonEmptyString(wsConfig.version) ?? readNonEmptyString(wsConfig.ha_version) ?? wsResult.haVersion,
      transport: 'websocket',
    };
  } catch {
    const restConfig = await callRest<Record<string, unknown>>(haConfig, '/api/config');
    return {
      config: restConfig,
      haVersion: readNonEmptyString(restConfig.version) ?? readNonEmptyString(restConfig.ha_version),
      transport: 'rest',
    };
  }
}

export async function fetchHaStates(haConfig: HomeAssistantConfig): Promise<{
  haVersion: string | null;
  states: HomeAssistantState[];
  transport: HomeAssistantTransport;
}> {
  try {
    const wsResult = await runWebSocketCommand(haConfig, 'get_states');
    return {
      haVersion: wsResult.haVersion,
      states: normalizeStates(wsResult.result),
      transport: 'websocket',
    };
  } catch {
    const restStates = await callRest<unknown[]>(haConfig, '/api/states');
    return {
      haVersion: null,
      states: normalizeStates(restStates),
      transport: 'rest',
    };
  }
}

// ── Parsing Helpers (exported for routes) ──

export { isRecord, readNonEmptyString };
