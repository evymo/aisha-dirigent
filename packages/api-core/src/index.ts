/**
 * @aisha/api-core — platform-agnostic HTTP + Realtime client.
 *
 * Replaces @supabase/supabase-js across web and mobile. Zero runtime
 * dependencies (only a `fetch` and `WebSocket` implementation must be
 * present in the host environment — both are available in browsers,
 * React Native and modern Node.js).
 *
 * Design principles:
 * - Thin, dependency-free core. Host app supplies token + URL.
 * - Identical { data, error } shape as supabase-js for drop-in migration.
 * - Typed RPC via generic `TFunctions` (web passes its Database type,
 *   mobile can pass `Record<string, { Args: unknown; Returns: unknown }>`).
 * - No globals: every instance is produced by a factory.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Token provider. Returns null when the user is anonymous. */
export type GetTokenFn = () => Promise<string | null>;

/** Shape of `Database['public']['Functions']` from generated Supabase types. */
export type FunctionsMap = Record<
  string,
  { Args: Record<string, unknown> | Record<string, never>; Returns: unknown }
>;

// Indexovaný přístup, ne `extends { Returns: infer R }`: FunctionsMap oba klíče
// zaručuje, takže pro jednu funkci je výsledek týž. Rozdíl je u NEZÚŽENÉHO F
// (např. `ReturnType<typeof rpc>` ve `vi.mocked(aisha.rpc)`): `infer` sbírá kandidáty
// ze sjednocení všech funkcí a slévá je redukcí podtypů (≈ n² porovnání) — od ~1 700
// funkcí tsc hlásí TS2590 „union type that is too complex“ (naměřeno 2026-09-29, kolo 12:
// 1 701 prošlo, 1 708 ne). Indexovaný přístup sjednocení redukcí podtypů neprohání.

/** Narrowed args for a single function. */
export type RpcArgsOf<
  TFunctions extends FunctionsMap,
  F extends keyof TFunctions,
> = TFunctions[F]['Args'];

/** Narrowed return for a single function. */
export type RpcReturnOf<
  TFunctions extends FunctionsMap,
  F extends keyof TFunctions,
> = TFunctions[F]['Returns'];

/**
 * Normalized error — supabase-js-compatible.
 *
 * `status` je PŘÍDAVEK nad tím kompatibilním tvarem a nese HTTP kód odpovědi. Bez něj
 * volající nepozná „server odmítl mou identitu" od „server nerozuměl datům" —
 * má jen text zprávy, který se liší podle nasazení a jazyka. Offline fronta
 * mobilu na tom rozdílu stojí: odmítnutí identity NENÍ vada té mutace a nesmí
 * spotřebovat pokus, jinak se po třech odmítnutích zahodí práce z terénu.
 *
 * ⭐ CHYBĚJÍCÍ `status` JE TAKY INFORMACE, ne mezera: znamená, že odpověď nikdy
 * nepřišla (fetch se neuskutečnil). Proto se nedoplňuje žádnou náhradní
 * hodnotou — „0" ani „500" by z nedostupné sítě udělaly odpověď serveru.
 *
 * ⭐ `code` NESE I PŮVOD ODMÍTNUTÍ, ne jen SQLSTATE. Samotný status nestačí:
 * 403 posílá dveřník (edge, „jsi zamčený") I aplikace (nárok na TENHLE úkon).
 * Odmítnutí od dveřníka proto dostane `code: DOOR_ERROR_CODE` — viz `parseError`.
 */
export type ApiError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  /** HTTP status odpovědi. `undefined` = odpověď nedorazila (síť), ne „neznámo". */
  status?: number;
};

/** Drop-in result shape — matches `{ data, error }` contract. */
export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
};

/** Options for microservice invocation (drop-in for supabase.functions.invoke). */
export type InvokeOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
};

/** Minimal API client surface used by hooks. */
export interface ApiClient<TFunctions extends FunctionsMap = FunctionsMap> {
  rpc<F extends keyof TFunctions>(
    functionName: F,
    args?: RpcArgsOf<TFunctions, F>,
  ): Promise<ApiResponse<RpcReturnOf<TFunctions, F>>>;

  invoke<T = unknown>(
    functionName: string,
    options?: InvokeOptions,
  ): Promise<ApiResponse<T>>;
}

/** Config for `createApiCore`. */
export type ApiCoreConfig = {
  /** Base URL of the Fastify API gateway (e.g. "https://api.example.com"). */
  gatewayUrl: string;
  /** Async token provider — called on every request. */
  getToken: GetTokenFn;
  /** Request timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
  /** Optional hook for logging warnings without importing a logger. */
  onWarn?: (scope: string, err: unknown) => void;
};

// ---------------------------------------------------------------------------
// Metrics bridge — OPTIONAL, no-op-by-default access to the AISHA Prometheus
// counters defined in `@aisha/observability`.
//
// WHY inline + no import: `@aisha/api-core` is a zero-dependency package shared
// by web and React Native. It MUST NOT pull in `prom-client` / the OTEL SDK, so
// it never imports `@aisha/observability`. Instead it reads the process-global
// metrics handle a server publishes at startup (same `__aishaMetrics__` slot as
// `@aisha/llm-dispatch`) and falls back to a no-op when absent (browser / RN /
// tests). This is how the shared `aisha_rpc_calls_total` counter gets a producer
// without breaking non-server consumers.
//
// INVARIANTS: bounded label cardinality — only `rpc` (the RPC function name, a
// fixed set from generated types, never free-form user input) and `status`
// ('ok' | 'error') are used as labels; fully no-op when nothing is registered.
// ---------------------------------------------------------------------------

/** Structural subset of a prom-client Counter — no prom-client dependency. */
interface MetricCounterLike {
  inc(labels?: Record<string, string | number>, value?: number): void;
}

/** Structural subset of a prom-client Histogram. */
interface MetricHistogramLike {
  observe(labels: Record<string, string | number>, value: number): void;
}

interface AishaMetricsHandle {
  rpcCalls?: MetricCounterLike;
  rpcDuration?: MetricHistogramLike;
}

const METRICS_GLOBAL_KEY = "__aishaMetrics__";

/**
 * Record one RPC call against `aisha_rpc_calls_total{rpc,status}` and observe
 * its duration on `aisha_rpc_duration_ms{rpc}`. No-op when no server registered
 * a metrics handle (browser / React Native / scripts / tests). Never throws.
 */
function recordRpcCall(rpc: string, status: "ok" | "error", durationMs: number): void {
  const handle = (globalThis as Record<string, unknown>)[METRICS_GLOBAL_KEY] as
    | AishaMetricsHandle
    | undefined;
  if (!handle) return;
  try {
    const rpcCalls = handle.rpcCalls;
    if (rpcCalls) rpcCalls.inc({ rpc, status });
    const rpcDuration = handle.rpcDuration;
    if (rpcDuration) rpcDuration.observe({ rpc }, durationMs);
  } catch {
    // Metrics are best-effort — a registry error must never break an RPC call.
  }
}

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------

async function buildAuthHeaders(
  getToken: GetTokenFn,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Značka, kterou si na odmítnutí dává NÁŠ dveřník (`x-aisha-door: locked`).
 *
 * ⭐ Proč hlavička a ne odvození z toho, že tělo nemá `code`: 403 posílá i
 * aplikace (RLS, `errcode 42501` — „na tenhle úkon nemáš nárok"). Rozlišovat je
 * podle TVARU CIZÍ ODPOVĚDI by znamenalo měřidlo, které nemáme čím doložit a
 * které mlčky přestane platit, až protistrana tvar změní. Dveřník je náš, tak
 * se označí sám — a tady se ta značka překládá na `code`, aby konzumenti
 * (offline fronta) nemuseli sahat na hlavičky.
 */
const DOOR_HEADER = "x-aisha-door";

/** `code`, který dostane odmítnutí OD DVEŘNÍKA. Není to SQLSTATE a nemá s ním kolidovat. */
export const DOOR_ERROR_CODE = "AISHA_DOOR_LOCKED";

async function parseError(response: Response): Promise<ApiError> {
  // Dveřník má přednost před tělem: jeho odmítnutí žádné použitelné nemá.
  if (response.headers?.get?.(DOOR_HEADER) === "locked") {
    return {
      message: response.statusText || `HTTP ${response.status}`,
      code: DOOR_ERROR_CODE,
      status: response.status,
    };
  }
  // `status` se bere z ODPOVĚDI, nikdy z těla: tělo píše protistrana a u
  // odmítnutí na hraně (edge, proxy) často žádné použitelné není. Proto se
  // přiřazuje i ve větvi, kde se JSON nepodařilo přečíst — právě tam je totiž
  // status jediné, co o odmítnutí víme.
  try {
    const body = (await response.json()) as Partial<ApiError>;
    return {
      message: body.message ?? response.statusText ?? `HTTP ${response.status}`,
      code: body.code,
      details: body.details,
      hint: body.hint,
      status: response.status,
    };
  } catch {
    return { message: response.statusText || `HTTP ${response.status}`, status: response.status };
  }
}

// ---------------------------------------------------------------------------
// createApiCore
// ---------------------------------------------------------------------------

/**
 * Create an AbortSignal that fires after `ms` milliseconds.
 * Portable alternative to `AbortSignal.timeout(ms)` (which requires ES2022 and
 * isn't available in all React Native runtimes).
 */
function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Create a typed HTTP client.
 *
 * @example
 * ```ts
 * const api = createApiCore<Database['public']['Functions']>({
 *   gatewayUrl: "https://api.example.com",
 *   getToken: async () => keycloakAccessToken,
 * });
 * const { data, error } = await api.rpc("get_my_roles");
 * ```
 */
export function createApiCore<TFunctions extends FunctionsMap = FunctionsMap>(
  config: ApiCoreConfig,
): ApiClient<TFunctions> {
  const { gatewayUrl, getToken, timeoutMs = 30_000, onWarn } = config;

  const stripTrailing = (url: string): string => url.replace(/\/+$/, "");
  const base = stripTrailing(gatewayUrl);

  async function rpc<F extends keyof TFunctions>(
    functionName: F,
    ...rest: RpcArgsOf<TFunctions, F> extends Record<string, never>
      ? []
      : [args: RpcArgsOf<TFunctions, F>]
  ): Promise<ApiResponse<RpcReturnOf<TFunctions, F>>> {
    const args = rest[0] as Record<string, unknown> | undefined;
    // Metrics: emit aisha_rpc_calls_total{rpc,status} + aisha_rpc_duration_ms{rpc}
    // once per call. `rpc` is the (bounded) function name; `status` defaults to
    // 'error' and is flipped to 'ok' on a successful response. No-op unless a
    // server registered a metrics handle. Date.now() (not performance.now) for
    // React Native portability.
    const rpcName = String(functionName);
    const startedAt = Date.now();
    let status: "ok" | "error" = "error";
    try {
      const headers = await buildAuthHeaders(getToken);
      const url = `${base}/rest/v1/rpc/${rpcName}`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(args ?? {}),
        signal: createTimeoutSignal(timeoutMs),
      });
      if (!response.ok) return { data: null, error: await parseError(response) };
      if (response.status === 204) {
        status = "ok";
        return { data: null as unknown as RpcReturnOf<TFunctions, F>, error: null };
      }
      const data = (await response.json()) as RpcReturnOf<TFunctions, F>;
      status = "ok";
      return { data, error: null };
    } catch (err) {
      onWarn?.("api.rpc.failed", err);
      const message = err instanceof Error ? err.message : "Network error";
      return { data: null, error: { message } };
    } finally {
      recordRpcCall(rpcName, status, Date.now() - startedAt);
    }
  }

  async function invoke<T = unknown>(
    functionName: string,
    options?: InvokeOptions,
  ): Promise<ApiResponse<T>> {
    try {
      const method = options?.method ?? "POST";
      const headers = await buildAuthHeaders(getToken, options?.headers);
      const url = `${base}/functions/v1/${functionName}`;
      const response = await fetch(url, {
        method,
        headers,
        body: options?.body != null ? JSON.stringify(options.body) : undefined,
        signal: createTimeoutSignal(timeoutMs),
      });
      if (!response.ok) return { data: null, error: await parseError(response) };
      if (response.status === 204) return { data: null, error: null };
      const data = (await response.json()) as T;
      return { data, error: null };
    } catch (err) {
      onWarn?.("api.invoke.failed", err);
      const message = err instanceof Error ? err.message : "Network error";
      return { data: null, error: { message } };
    }
  }

  return { rpc, invoke } as ApiClient<TFunctions>;
}

// ---------------------------------------------------------------------------
// Realtime — drop-in for supabase.channel().on("postgres_changes", ...)
// ---------------------------------------------------------------------------

/** PG change event payload — identical shape to supabase-js. */
export type PostgresChangePayload<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
  errors: string[] | null;
};

export type ChangeFilter = {
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  schema: string;
  table: string;
  filter?: string;
};

type ChangeCallback<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (payload: PostgresChangePayload<T>) => void;

type Listener = { filter: ChangeFilter; callback: ChangeCallback };

export type RealtimeClientConfig = {
  /** WebSocket URL (e.g. "wss://api.example.com/realtime/v1"). */
  wsUrl: string;
  getToken: GetTokenFn;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  onError?: (scope: string, err: unknown) => void;
};

/**
 * Single realtime subscription — wraps a WebSocket + filter dispatching.
 * Public API mirrors `supabase.channel(name).on(...).subscribe()`.
 */
export class RealtimeChannel {
  readonly name: string;
  private readonly config: Required<Omit<RealtimeClientConfig, "onError">> & {
    onError?: (scope: string, err: unknown) => void;
  };
  private listeners: Listener[] = [];
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay: number;
  private isSubscribed = false;
  private isClosed = false;

  constructor(name: string, config: RealtimeClientConfig) {
    this.name = name;
    this.config = {
      wsUrl: config.wsUrl,
      getToken: config.getToken,
      reconnectDelayMs: config.reconnectDelayMs ?? 2_000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30_000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30_000,
      onError: config.onError,
    };
    this.reconnectDelay = this.config.reconnectDelayMs;
  }

  on(
    _eventType: "postgres_changes",
    filter: ChangeFilter,
    callback: ChangeCallback,
  ): this {
    this.listeners.push({ filter, callback });
    return this;
  }

  subscribe(): this {
    if (this.isSubscribed) return this;
    this.isSubscribed = true;
    void this.connect();
    return this;
  }

  unsubscribe(): void {
    this.isClosed = true;
    this.isSubscribed = false;
    this.cleanup();
  }

  private async connect(): Promise<void> {
    if (this.isClosed) return;
    try {
      const token = await this.config.getToken();
      const url = new URL(this.config.wsUrl);
      url.searchParams.set("channel", this.name);
      if (token) url.searchParams.set("token", token);
      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => {
        this.reconnectDelay = this.config.reconnectDelayMs;
        const subscribeMsg = {
          type: "subscribe",
          channel: this.name,
          filters: this.listeners.map((l) => l.filter),
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: "heartbeat" }));
          }
        }, this.config.heartbeatIntervalMs);
      };

      // The onmessage signature differs subtly between browsers (MessageEvent)
      // and React Native (WebSocketMessageEvent). Both expose `data` on the
      // event object, so we attach via cast to satisfy both typings.
      (this.ws as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage = (
        event,
      ) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            payload?: PostgresChangePayload;
          };
          if (msg.type === "postgres_changes" && msg.payload) {
            this.dispatch(msg.payload);
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      this.ws.onclose = () => {
        this.cleanup();
        if (!this.isClosed) this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose follows — handled there.
      };
    } catch (err) {
      this.config.onError?.("realtime.connect", err);
      if (!this.isClosed) this.scheduleReconnect();
    }
  }

  private dispatch(payload: PostgresChangePayload): void {
    for (const listener of this.listeners) {
      const f = listener.filter;
      if (f.schema !== payload.schema || f.table !== payload.table) continue;
      if (f.event !== "*" && f.event !== payload.eventType) continue;
      if (f.filter && !this.matchFilter(f.filter, payload)) continue;
      try {
        listener.callback(payload);
      } catch (err) {
        this.config.onError?.("realtime.callback", err);
      }
    }
  }

  private matchFilter(filter: string, payload: PostgresChangePayload): boolean {
    const match = filter.match(/^(\w+)=eq\.(.+)$/);
    if (!match) return true;
    const [, column, value] = match;
    const row = payload.new as Record<string, unknown>;
    return String(row[column]) === value;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.config.maxReconnectDelayMs,
      );
      void this.connect();
    }, this.reconnectDelay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === 0 || this.ws.readyState === 1) this.ws.close();
      this.ws = null;
    }
  }
}

/** Realtime client surface — mirrors `supabase.channel` / `removeChannel`. */
export interface RealtimeClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): void;
}

/**
 * Create a realtime client that tracks channels and provides `removeChannel`.
 * Each host app (web / mobile) constructs its own instance with its own
 * WebSocket URL and token source.
 */
export function createRealtimeClient(config: RealtimeClientConfig): RealtimeClient {
  const active = new Map<string, RealtimeChannel>();
  return {
    channel(name: string): RealtimeChannel {
      const existing = active.get(name);
      if (existing) return existing;
      const ch = new RealtimeChannel(name, config);
      active.set(name, ch);
      return ch;
    },
    removeChannel(channel: RealtimeChannel): void {
      channel.unsubscribe();
      active.delete(channel.name);
    },
  };
}
