/**
 * @aisha/ide-bridge/bridge — high-level bridge orchestrator.
 *
 * Composes the HTTP `/instructions/:ide` REST endpoint (initial sync +
 * fallback poll) with the WS `/subscribe/:workspaceId?` realtime push
 * (per Phase 13 WP 13.4). When a `context_changed` event arrives,
 * fetches the rendered IDE instructions and writes the target file via
 * `safeWriteSync`.
 *
 * Reconnect strategy:
 *   - Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped)
 *   - Jitter: ±20% on each delay (prevents thundering herd when a fleet
 *     of bridges reconnects after svc-ide-context restart)
 *   - Auth-close (4001) → fetch fresh token via `tokenProvider` callback
 *     then reconnect; never give up
 *   - Forbidden-close (4003) → stop reconnecting (the user lost access)
 *
 * Per `feedback_agent_on_user_machine_safety.md`:
 *   - JWT lives in the OS keychain (or env var), NEVER plaintext on disk
 *     in the bridge config (caller owns the keychain plumbing — we just
 *     accept a tokenProvider function)
 *   - Bridge sends ONLY user_id + workspace_id to the backend; never the
 *     file path or repo contents (privacy guard)
 */
import WebSocket from "ws";
import { z } from "zod";
import { safeWriteSync, type SafeWriteResult } from "./safe-write.js";

// ─── IDE registry ────────────────────────────────────────────────────────────

export type SupportedIde = "claude-code" | "cursor" | "copilot" | "jetbrains";

export const SUPPORTED_IDES: ReadonlyArray<SupportedIde> = [
  "claude-code",
  "cursor",
  "copilot",
  "jetbrains",
] as const;

/** Default output filename per IDE (relative to bridge rootDir). */
export const IDE_DEFAULT_OUTPUT_PATH: Record<SupportedIde, string> = {
  "claude-code": "CLAUDE.md",
  cursor: ".cursorrules",
  copilot: ".github/copilot-instructions.md",
  jetbrains: ".idea/aisha-ai-prompt-config.json",
};

// ─── Wire-message Zod schemas ────────────────────────────────────────────────

const ReadyMessageSchema = z.object({
  type: z.literal("ready"),
  envelope: z.unknown(),
});

const ContextChangedMessageSchema = z.object({
  type: z.literal("context_changed"),
  envelope: z.unknown(),
});

const PongMessageSchema = z.object({
  type: z.literal("pong"),
});

const ServerMessageSchema = z.union([
  ReadyMessageSchema,
  ContextChangedMessageSchema,
  PongMessageSchema,
]);

// ─── Backoff config (exposed for tests) ──────────────────────────────────────

/** Reconnect backoff schedule (seconds). Capped at last entry. */
export const RECONNECT_BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const;
/** ± jitter ratio per delay (e.g. 0.2 = ±20%). */
export const JITTER_RATIO = 0.2;
/** Keepalive ping interval (ms). */
export const PING_INTERVAL_MS = 30_000;

export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = RECONNECT_BACKOFF_SECONDS[
    Math.min(attempt, RECONNECT_BACKOFF_SECONDS.length - 1)
  ];
  const jitter = (rand() * 2 - 1) * JITTER_RATIO * base;
  return Math.max(0, Math.round((base + jitter) * 1000));
}

// ─── Bridge config ───────────────────────────────────────────────────────────

export interface BridgeConfig {
  /** Base URL of svc-ide-context (e.g. `https://ide-context.aisha.guru`). */
  serviceUrl: string;
  /** Optional workspace ID (matches `/subscribe/:workspaceId?`). */
  workspaceId?: string | null;
  /** IDE this bridge writes for (drives template choice + output path). */
  ide: SupportedIde;
  /** Repo root used for backups (`<rootDir>/.aisha/backups/`). */
  rootDir: string;
  /**
   * Optional override of output path (defaults per IDE — see
   * IDE_DEFAULT_OUTPUT_PATH).
   */
  outputPath?: string;
  /**
   * Returns a fresh JWT each time the bridge needs one (REST fetch +
   * WS connect). Caller owns keychain / refresh plumbing; we just
   * call this and get a Bearer-eligible string.
   */
  tokenProvider: () => Promise<string>;
  /** Logger surface (default: silent — pin a real logger from caller). */
  logger?: BridgeLogger;
  /** Override the safeWriteSync function (test seam). */
  writer?: typeof safeWriteSync;
  /**
   * Override the WebSocket constructor (test seam — pass `ws` or a
   * mocked class).
   */
  wsImpl?: typeof WebSocket;
  /**
   * Override the fetch implementation (test seam). Defaults to global
   * fetch (Node 22+).
   */
  fetchImpl?: typeof fetch;
}

export interface BridgeLogger {
  info: (msg: unknown) => void;
  warn: (msg: unknown) => void;
  error: (msg: unknown) => void;
}

const SILENT_LOGGER: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Bridge orchestrator ─────────────────────────────────────────────────────

export class IdeBridge {
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private currentBackoffMs = 0;
  private readonly logger: BridgeLogger;
  private readonly writer: typeof safeWriteSync;
  private readonly WS: typeof WebSocket;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly cfg: BridgeConfig) {
    this.logger = cfg.logger ?? SILENT_LOGGER;
    this.writer = cfg.writer ?? safeWriteSync;
    this.WS = cfg.wsImpl ?? WebSocket;
    this.fetchFn = cfg.fetchImpl ?? fetch;
  }

  /** Output path for this bridge (config override OR IDE default). */
  outputPath(): string {
    return this.cfg.outputPath ?? IDE_DEFAULT_OUTPUT_PATH[this.cfg.ide];
  }

  /** Most recent reconnect backoff (exposed for tests). */
  lastBackoffMs(): number {
    return this.currentBackoffMs;
  }

  /**
   * One-shot sync: fetch latest instructions over REST, write to disk.
   * Useful for `npx aisha-ide-bridge sync` (no daemon).
   */
  async syncOnce(): Promise<SafeWriteResult> {
    const body = await this.fetchInstructions();
    return this.writer({
      rootDir: this.cfg.rootDir,
      outputPath: this.outputPath(),
      newContent: body,
    });
  }

  /**
   * Start daemon mode: initial sync, then maintain WS connection with
   * reconnect-with-backoff. Returns immediately; the caller polls
   * `stop()` to tear down.
   */
  async start(): Promise<void> {
    this.stopped = false;
    // Initial sync via REST so the file is correct even before WS opens
    await this.syncOnce().catch((err: unknown) => {
      this.logger.warn({ msg: "Initial sync failed", err: errorMessage(err) });
    });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.socket !== null) {
      try {
        this.socket.close(1000, "Bridge shutting down");
      } catch {
        // best-effort
      }
      this.socket = null;
    }
  }

  /**
   * Fetch fresh instructions over REST. Used by `syncOnce()` and on
   * every `context_changed` event.
   */
  private async fetchInstructions(): Promise<string> {
    const url = new URL(`/instructions/${this.cfg.ide}`, this.cfg.serviceUrl);
    if (this.cfg.workspaceId) {
      url.searchParams.set("workspace", this.cfg.workspaceId);
    }
    const token = await this.cfg.tokenProvider();
    const resp = await this.fetchFn(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new Error(`Instructions fetch failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.text();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const wsUrl = new URL(
      `/subscribe${this.cfg.workspaceId ? "/" + encodeURIComponent(this.cfg.workspaceId) : ""}`,
      this.cfg.serviceUrl,
    );
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

    let token: string;
    try {
      token = await this.cfg.tokenProvider();
    } catch (err) {
      this.logger.error({ msg: "Token provider failed", err: errorMessage(err) });
      this.scheduleReconnect();
      return;
    }

    const ws = new this.WS(wsUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.socket = ws;

    ws.on("open", () => {
      this.logger.info({ msg: "WS connected", ide: this.cfg.ide });
      this.reconnectAttempt = 0;
      this.startPing();
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      void this.handleMessage(String(raw));
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.stopPing();
      this.socket = null;
      if (this.stopped) return;
      // 4003 = forbidden → don't retry (user lost access)
      if (code === 4003) {
        this.logger.error({ msg: "Bridge forbidden — stopping", reason: reason.toString() });
        this.stopped = true;
        return;
      }
      // 4001 = auth (token expired) — caller's tokenProvider must mint
      // a fresh one; we just reconnect and ask for a new token next round.
      this.scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      this.logger.warn({ msg: "WS error", err: err.message });
      // The 'close' event always follows; let it drive the reconnect.
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn({ msg: "Non-JSON WS message, ignoring" });
      return;
    }
    const validated = ServerMessageSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn({ msg: "Malformed WS message, ignoring" });
      return;
    }

    if (validated.data.type === "pong") {
      return;
    }

    // ready + context_changed both trigger a REST refetch — keeps the
    // bridge's sole writer path (no need to render templates client-side).
    try {
      const body = await this.fetchInstructions();
      const result = this.writer({
        rootDir: this.cfg.rootDir,
        outputPath: this.outputPath(),
        newContent: body,
      });
      this.logger.info({
        msg: "Synced",
        event: validated.data.type,
        outcome: result.outcome,
        backup: result.backupFile,
        preservedUserSection: result.preservedUserSection,
      });
    } catch (err) {
      this.logger.error({ msg: "Sync after event failed", err: errorMessage(err) });
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = backoffDelayMs(this.reconnectAttempt);
    this.currentBackoffMs = delay;
    this.reconnectAttempt += 1;
    this.logger.info({ msg: "Reconnect scheduled", attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket !== null && this.socket.readyState === this.WS.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: "ping" }));
        } catch {
          // best-effort; close handler will cycle reconnect
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}
