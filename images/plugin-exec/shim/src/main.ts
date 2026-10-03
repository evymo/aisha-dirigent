/**
 * plugin-exec entrypoint — runs inside Kata/Docker microVM.
 *
 * Reads plugin code and params from PLUGIN_PAYLOAD env (passed by runner).
 * Executes the plugin function using node:vm for basic scope isolation
 * (full kernel isolation is provided by the container/VM boundary).
 * ctx.* calls go to svc-plugin-system broker via HTTP.
 *
 * Output protocol (stdout, one JSON line each):
 *   { level, message, meta? }           — log line (ctx.log)
 *   { __result: true, value: <result> } — final result (last line)
 */

import { createContext, runInContext } from 'node:vm';
import { createSandboxContext, nactiKonfiguraci, type LogLine, type ScheduleDeclaration } from './broker.js';

// ── Read inputs ──────────────────────────────────────────────────────────────

const rawPayload = process.env.PLUGIN_PAYLOAD ?? '{}';
let payload: Record<string, unknown>;
try {
  payload = JSON.parse(rawPayload) as Record<string, unknown>;
} catch {
  process.stderr.write('Fatal: invalid PLUGIN_PAYLOAD JSON\n');
  process.exit(1);
}

const pluginCode = String(payload['plugin_code'] ?? '');
const action = String(payload['action'] ?? 'default');
const params = (payload['params'] ?? {}) as Record<string, unknown>;
const timeoutMs = parseInt(String(process.env.EXEC_TIMEOUT_MS ?? '30000'), 10);

// Identity + configuration for this run. Version and tenant come from the
// payload (the host authorized the tenant); CONFIGURATION does not — the payload
// travels in the container ENV and must never carry credentials, so it is fetched
// from the broker on this run's token (nactiKonfiguraci). Nothing here invents a
// value: a connector run against a guessed endpoint or an empty credential set is
// worse than one that refuses to start.
let konfigurace: Record<string, unknown>;
try {
  konfigurace = await nactiKonfiguraci();
} catch (err) {
  process.stderr.write(`Fatal: plugin configuration unavailable — ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
const identity = {
  plugin: { version: String((payload['plugin_version'] ?? '') || 'unknown') },
  tenant: { id: String(payload['tenant_id'] ?? '') },
  config: konfigurace,
};

if (!pluginCode) {
  process.stderr.write('Fatal: plugin_code is required in PLUGIN_PAYLOAD\n');
  process.exit(1);
}

// ── Execute ──────────────────────────────────────────────────────────────────

const logs: LogLine[] = [];
const declaredSchedules: ScheduleDeclaration[] = [];
const ctx = createSandboxContext(logs, identity, declaredSchedules);

// Sandbox: restrict globals available to plugin code.
// The VM sandbox provides scope isolation; the container provides OS isolation.
const sandbox = createContext({
  ctx,
  action,
  params,
  console: {
    log: (...args: unknown[]) => ctx.log('info', args.map(String).join(' ')),
    warn: (...args: unknown[]) => ctx.log('warn', args.map(String).join(' ')),
    error: (...args: unknown[]) => ctx.log('error', args.map(String).join(' ')),
  },
  // Explicitly block dangerous globals
  require: undefined,
  process: undefined,
  __dirname: undefined,
  __filename: undefined,
  global: undefined,
  globalThis: undefined,
});

try {
  // Wrap plugin code in an async function and invoke with ctx, action, params
  const wrappedCode = `(async (ctx, action, params) => {
${pluginCode}
})(ctx, action, params)`;

  const resultPromise = runInContext(wrappedCode, sandbox, {
    filename: 'plugin.js',
    timeout: timeoutMs,
  }) as Promise<unknown>;

  const result = await Promise.race([
    resultPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Plugin execution timeout')), timeoutMs),
    ),
  ]);

  // Emit result as last stdout line. `schedules` carries what init() DECLARED
  // (see SandboxContext.schedule): additive field, so an older reader that only
  // looks at `value` is unaffected. Reconciling them into `plugin_schedules` is
  // the host's job and is deliberately not done here — this container is gone
  // a moment from now.
  process.stdout.write(
    JSON.stringify({ __result: true, value: result, schedules: declaredSchedules }) + '\n',
  );
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ level: 'error', message }) + '\n');
  process.exit(1);
}
