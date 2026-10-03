/**
 * Broker client — in-VM SandboxContext implementation.
 *
 * Runs inside the plugin-exec container. Forwards ctx.* calls to
 * svc-plugin-system's /sandbox/* broker endpoints, authenticated with the
 * short-lived BROKER_TOKEN scoped to this specific run.
 *
 * The broker enforces: RPC whitelist, network allowlist, rate limiting,
 * audit logging — all outside this VM, on the Backend host.
 */

const brokerUrl = process.env.BROKER_URL ?? '';
const brokerToken = process.env.BROKER_TOKEN ?? '';
const runId = process.env.RUN_ID ?? '';

async function brokerCall<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${brokerUrl}/sandbox/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${brokerToken}`,
      'X-Run-Id': runId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Broker ${endpoint} error ${res.status}: ${detail.slice(0, 200)}`);
  }

  // Void operations (kv.set, kv.delete, notify) legitimately return
  // "204 No Content" with an empty body. Short-circuit before res.json()
  // so an empty body does not throw a SyntaxError; resolve to undefined.
  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return undefined as T;
  }
  const text = await res.text();
  if (text.length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/** Schedule a plugin DECLARED from init(). See `schedule` on SandboxContext. */
/**
 * Deklarace rozvrhu: v `cron` spustit `capability` z manifestu. Host ji zapíše do
 * `plugin_schedules` (reconcile_plugin_schedules) a jeho plánovač ji spouští.
 * `capability: null` = plugin volal starým tvarem `schedule(cron, fn)` — host takovou
 * deklaraci odmítne nahlas, callback se nikdy nevolal.
 */
export type ScheduleDeclaration = { cron: string; capability: string | null };

/** Identity + configuration the host hands the plugin for this run. */
export interface SandboxIdentity {
  plugin: { version: string };
  tenant: { id: string };
  config: Record<string, unknown>;
}

/** SandboxContext wired to the broker — same interface as svc-plugin-system. */
export interface SandboxContext extends SandboxIdentity {
  /**
   * Declare a recurring invocation. NOT a runtime timer: this container is
   * one-shot — it runs, answers, and dies, so a callback registered here could
   * never fire. `init()` therefore DECLARES its cadence and the host is what
   * schedules; the declarations are collected and emitted in the result
   * envelope so the host can reconcile them into `plugin_schedules`.
   *
   * The second argument NAMES the manifest capability the host re-invokes on
   * that cadence (2026-09-16: it used to be a callback nobody could ever call,
   * so the host had no way to know WHICH capability a cron belonged to).
   */
  schedule: (cron: string, capability: string) => void;
  rpc: <T = unknown>(fn: string, params: Record<string, unknown>) => Promise<T>;
  kv: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  llm: (prompt: string, options?: { model?: string; maxTokens?: number }) => Promise<string>;
  notify: (userId: string, title: string, body: string) => Promise<void>;
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export type LogLine = { level: string; message: string; meta?: Record<string, unknown> };

export function createSandboxContext(
  logs: LogLine[],
  identity: SandboxIdentity,
  declared: ScheduleDeclaration[],
): SandboxContext {
  return {
    // Identity + per-tenant configuration. These are NOT conveniences: a
    // connector without `config` has no credentials and no endpoint, so it
    // could only ever fail — which is exactly how the gap showed up (plugins
    // read ctx.config/ctx.plugin/ctx.tenant/ctx.schedule; the shim provided
    // none of the four).
    plugin: identity.plugin,
    tenant: identity.tenant,
    config: identity.config,

    schedule: (cron: string, capability: unknown) => {
      declared.push({ cron: String(cron), capability: typeof capability === 'string' ? capability : null });
    },

    rpc: <T = unknown>(fn: string, params: Record<string, unknown>) =>
      brokerCall<T>('rpc', { fn, params }),

    kv: {
      get: (key: string) => brokerCall<unknown>('kv/get', { key }),
      set: (key: string, value: unknown) => brokerCall<void>('kv/set', { key, value }),
      delete: (key: string) => brokerCall<void>('kv/delete', { key }),
    },

    fetch: async (url: string, init?: RequestInit) => {
      // Proxy through broker which enforces the network allowlist. The broker
      // runs every request through the SSRF guard's safeFetch, whatever the
      // `redirect` mode: 'follow' follows under the guard's redirect policy
      // (each hop re-checked; headers and body never cross to another origin),
      // 'manual' hands the 3xx back here, 'error' rejects. Forwarding the mode
      // keeps fetch semantics — before, it was dropped and every redirect was
      // followed even when the plugin asked for 'manual' or 'error'.
      const result = await brokerCall<{ status: number; headers: Record<string, string>; body: string }>(
        'fetch',
        {
          url,
          method: init?.method ?? 'GET',
          // Normalise HeadersInit (Headers / tuple array / record) to a plain
          // record: JSON.stringify(new Headers(...)) is `{}`, which silently
          // dropped every header a plugin passed as a Headers instance.
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: init?.body ?? null,
          redirect: init?.redirect ?? 'follow',
        },
      );
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    },

    llm: (prompt: string, options?: { model?: string; maxTokens?: number }) =>
      brokerCall<string>('llm', { prompt, ...options }),

    notify: (userId: string, title: string, body: string) =>
      brokerCall<void>('notify', { userId, title, body }),

    log: (level: string, message: string, meta?: Record<string, unknown>) => {
      logs.push({ level, message, meta });
      // Also emit as structured line so runner can capture it
      process.stdout.write(JSON.stringify({ level, message, meta }) + '\n');
    },
  };
}

/**
 * Konfigurace běhu (`ctx.config`) — vyzvednutá z brokeru na token TOHOTO běhu.
 *
 * ⛔ 2026-09-16: konfigurace jela v PLUGIN_PAYLOAD (ENV kontejneru, kam pověření
 * nesmí) a vždy byla `{}`. Broker (/sandbox/config) ji skládá v DB (výchozí →
 * zdroj → dešifrovaná pověření → přepis tenanta) pro plugin a tenanta z tokenu.
 * Selhání = běh se nespustí: konektor bez pověření by jen selhal jinde a hůř.
 */
export async function nactiKonfiguraci(): Promise<Record<string, unknown>> {
  if (!brokerUrl || !brokerToken) {
    throw new Error('BROKER_URL/BROKER_TOKEN chybí — konfiguraci běhu nelze vyzvednout');
  }
  const konfigurace = await brokerCall<unknown>('config', {});
  if (!konfigurace || typeof konfigurace !== 'object' || Array.isArray(konfigurace)) {
    throw new Error('broker vrátil konfiguraci, která není objekt');
  }
  return konfigurace as Record<string, unknown>;
}

