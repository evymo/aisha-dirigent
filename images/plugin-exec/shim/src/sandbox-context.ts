/**
 * The global scope a plugin sees inside the VM — the ONE place that defines it.
 *
 * A fresh `node:vm` context carries only the language intrinsics (Object, JSON,
 * Promise, Date, …). Everything a browser or Node adds on top — timers, URL,
 * AbortSignal — is NOT there unless it is put there. Measured 2026-10-03 in
 * production: every data-source plugin calls `AbortSignal.timeout(…)` before its
 * first request, the context did not carry it, and the run ended
 * "ReferenceError: AbortSignal is not defined" (24 runs in a row). The plugins'
 * unit tests run in plain Node, where these globals exist, so they could not see
 * it; the gate `plugin-dorazi-do-sandboxu` now RUNS every bundled plugin through
 * this very function.
 *
 * The list is deliberately short — what plugins need to build a request and to
 * wait, nothing that reaches outside (no fetch, no process, no require): the
 * network goes through `ctx.fetch`, where the broker enforces the allowlist.
 * Handing over host-realm functions opens nothing new: `ctx` itself is a
 * host-realm object, so the VM is scope isolation only, and the container is
 * the boundary (see main.ts).
 *
 * Note for plugin authors: `ctx.fetch` honours `init.signal` for a SHORTER deadline
 * (AbortError once the signal aborts); the broker ceiling (STROP_BROKERU_MS, 15 s)
 * stays the upper bound — a longer signal cannot extend it. An `init` key the broker
 * does not apply (anything but method, headers, body, redirect, signal) is an error,
 * not a silently ignored option. A timer still pending when the plugin returns does
 * NOT keep the run alive — the shim ends the process right after the result.
 *
 * No imports on purpose: the gate loads this module from the repository root.
 */

/** Web-platform globals handed to the plugin. Add one only with a plugin that needs it. */
export const SANDBOX_WEB_GLOBALS = {
  AbortController,
  AbortSignal,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
} as const;

/** Host globals a bundle must not find in scope — explicitly shadowed. */
export const SANDBOX_BLOCKED_GLOBALS = {
  require: undefined,
  process: undefined,
  __dirname: undefined,
  __filename: undefined,
  global: undefined,
  globalThis: undefined,
} as const;

/** What `ctx.log` needs to back the plugin's `console`. */
interface LogSink {
  log(level: string, message: string): void;
}

/** The object passed to `createContext` for one plugin run. */
export function sandboxGlobals(ctx: LogSink, action: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    ctx,
    action,
    params,
    console: {
      log: (...args: unknown[]) => ctx.log('info', args.map(String).join(' ')),
      warn: (...args: unknown[]) => ctx.log('warn', args.map(String).join(' ')),
      error: (...args: unknown[]) => ctx.log('error', args.map(String).join(' ')),
    },
    ...SANDBOX_WEB_GLOBALS,
    // Explicitly block dangerous globals (last, so nothing above can re-open them).
    ...SANDBOX_BLOCKED_GLOBALS,
  };
}
