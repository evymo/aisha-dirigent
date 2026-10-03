/**
 * Matrix Client — lightweight Matrix C-S API wrapper using native fetch.
 *
 * No SDK dependency — pure REST calls to the Matrix homeserver.
 * Handles token exchange, message history, send, and a sync loop for
 * live message delivery.
 *
 * @module
 */

export interface MatrixCredentials {
  access_token: string;
  user_id: string;
  home_server: string;
}

export interface MatrixMessage {
  event_id: string;
  sender: string;
  origin_server_ts: number;
  content: {
    body: string;
    msgtype: string;
  };
}

export type MatrixMessageCallback = (messages: MatrixMessage[]) => void;

const CALL_TIMEOUT_MS = 10_000;
const SYNC_POLL_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

function tokenExchangeEndpoint(matrixServiceUrl: string): string {
  const base = matrixServiceUrl.replace(/\/+$/, "");
  if (/\/(?:token-exchange|matrix-token-exchange)$/i.test(base)) {
    return base;
  }
  return `${base}/token-exchange`;
}

// ── Token Exchange ────────────────────────────────────────────────────────────

/**
 * Exchange a backend access token for a Matrix access token via svc-matrix.
 * The service verifies the token, creates a Matrix account if needed, and
 * returns Matrix credentials.
 */
export async function exchangeMatrixToken(
  matrixServiceUrl: string,
  bearerToken: string,
): Promise<MatrixCredentials | null> {
  try {
    const resp = await fetch(tokenExchangeEndpoint(matrixServiceUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as MatrixCredentials;
    if (!data.access_token || !data.user_id) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Room Management ───────────────────────────────────────────────────────────

/**
 * Create a new Matrix room and return its room_id.
 * The creating user is automatically joined as admin.
 */
export async function createMatrixRoom(
  homeserverUrl: string,
  credentials: MatrixCredentials,
  name: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${homeserverUrl}/_matrix/client/v3/createRoom`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        preset: "private_chat",
        visibility: "private",
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as { room_id?: string };
    return data.room_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Join a Matrix room by room_id. No-op if already joined.
 */
export async function joinMatrixRoom(
  homeserverUrl: string,
  credentials: MatrixCredentials,
  roomId: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${homeserverUrl}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Message History ───────────────────────────────────────────────────────────

/**
 * Fetch room message history.
 * Returns the most recent `limit` text messages in chronological order.
 */
export async function getRoomHistory(
  homeserverUrl: string,
  credentials: MatrixCredentials,
  roomId: string,
  limit = 50,
): Promise<MatrixMessage[]> {
  try {
    const url =
      `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages` +
      `?dir=b&limit=${limit}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    if (!resp.ok) return [];

    const data = (await resp.json()) as { chunk?: unknown[] };
    const chunk = (data.chunk ?? []) as MatrixMessage[];

    // Reverse so oldest-first; keep only text messages
    return chunk.filter((e) => e.content?.msgtype === "m.text").reverse();
  } catch {
    return [];
  }
}

// ── Send Message ──────────────────────────────────────────────────────────────

/**
 * Send a plain text message to a Matrix room.
 * Returns the event_id on success, null on failure.
 */
export async function sendMatrixMessage(
  homeserverUrl: string,
  credentials: MatrixCredentials,
  roomId: string,
  text: string,
): Promise<string | null> {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const resp = await fetch(
      `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ msgtype: "m.text", body: text }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as { event_id?: string };
    return data.event_id ?? null;
  } catch {
    return null;
  }
}

// ── Sync Loop ─────────────────────────────────────────────────────────────────

export interface SyncLoopOptions {
  homeserverUrl: string;
  credentials: MatrixCredentials;
  roomId: string;
  onMessages: MatrixMessageCallback;
}

let syncController: AbortController | null = null;

/**
 * Start long-polling Matrix /sync loop.
 * Calls onMessages for each batch of new text messages in the room.
 * Stops any previously running loop first.
 */
export function startSyncLoop(opts: SyncLoopOptions): void {
  stopSyncLoop();
  syncController = new AbortController();
  void runSyncLoop(opts, syncController.signal);
}

/** Stop the active sync loop (e.g. on panel close or room change). */
export function stopSyncLoop(): void {
  if (syncController) {
    syncController.abort();
    syncController = null;
  }
}

async function runSyncLoop(opts: SyncLoopOptions, signal: AbortSignal): Promise<void> {
  let since: string | undefined;
  let backoff = 2_000;

  while (!signal.aborted) {
    try {
      const params = new URLSearchParams({ timeout: String(SYNC_POLL_TIMEOUT_MS) });
      if (since) params.set("since", since);

      const resp = await fetch(
        `${opts.homeserverUrl}/_matrix/client/v3/sync?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${opts.credentials.access_token}` },
          signal,
        },
      );

      if (signal.aborted) break;

      if (resp.status === 429) {
        const retryAfterSec = Number(resp.headers.get("Retry-After") ?? "5");
        await delayMs(Math.min(retryAfterSec * 1_000, MAX_BACKOFF_MS), signal);
        continue;
      }

      if (!resp.ok) {
        await delayMs(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }

      backoff = 2_000;

      const sync = (await resp.json()) as {
        next_batch: string;
        rooms?: {
          join?: Record<
            string,
            { timeline?: { events?: MatrixMessage[] } }
          >;
        };
      };

      since = sync.next_batch;

      const roomTimeline = sync.rooms?.join?.[opts.roomId]?.timeline?.events;
      if (roomTimeline?.length) {
        const textMsgs = roomTimeline.filter((e) => e.content?.msgtype === "m.text");
        if (textMsgs.length > 0) {
          opts.onMessages(textMsgs);
        }
      }
    } catch (err) {
      if (signal.aborted) break;
      await delayMs(backoff, signal).catch(() => { /* aborted */ });
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

function delayMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
