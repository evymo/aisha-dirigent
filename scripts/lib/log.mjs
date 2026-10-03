// =============================================================================
// log.mjs — Structured logger pro AISHA cold-start / redeploy / lokální dev
// =============================================================================
// Dual-mode: pretty (default) nebo JSON (CI / log aggregation).
//
// Kontrola výstupního módu přes env var:
//   AISHA_LOG_JSON=1  → JSON Lines (jeden objekt na řádek, stderr)
//   AISHA_LOG_LEVEL=debug|info|warn|error  → minimum verbosity (default: info)
//
// Usage:
//   import { mkLogger } from "./lib/log.mjs";
//   const log = mkLogger({ component: "redeploy" });
//   log.info("starting wave", { wave: 2, apps: ["aisha-core"] });
//   log.error("deploy failed", { app: "aisha-pki", reason: "timeout" });
//
// Pretty output:
//   ℹ [redeploy] starting wave  wave=2 apps=aisha-core
// JSON output:
//   {"ts":"2026-04-28T...","level":"info","component":"redeploy","msg":"starting wave","wave":2,"apps":["aisha-core"]}
// =============================================================================

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.AISHA_LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;
const JSON_MODE = process.env.AISHA_LOG_JSON === "1" || process.env.AISHA_LOG_JSON === "true";

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const LEVEL_PRETTY = {
  debug: C.dim("∘"),
  info:  C.blue("ℹ"),
  warn:  C.yellow("⚠"),
  error: C.red("✗"),
};

function fmtKVPretty(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${C.dim(k)}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
}

function emit(level, component, msg, fields = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();

  if (JSON_MODE) {
    // JSON Lines on stderr (one record per line, never interleaves with stdout data)
    const record = { ts, level, component, msg, ...fields };
    process.stderr.write(JSON.stringify(record) + "\n");
  } else {
    const tag = `[${component}]`;
    const fieldsStr = Object.keys(fields).length > 0 ? "  " + fmtKVPretty(fields) : "";
    process.stderr.write(`  ${LEVEL_PRETTY[level]} ${C.dim(tag)} ${msg}${fieldsStr}\n`);
  }
}

export function mkLogger({ component = "aisha" } = {}) {
  return {
    debug: (msg, fields) => emit("debug", component, msg, fields),
    info:  (msg, fields) => emit("info",  component, msg, fields),
    warn:  (msg, fields) => emit("warn",  component, msg, fields),
    error: (msg, fields) => emit("error", component, msg, fields),

    // Phase markers — emit structured event s `phase: "start"|"end"` + duration
    phase(name, fn) {
      emit("info", component, `phase ${name} start`, { phase: name, event: "start" });
      const t0 = Date.now();
      const result = fn();
      const finalize = () => {
        const duration_ms = Date.now() - t0;
        emit("info", component, `phase ${name} end`, { phase: name, event: "end", duration_ms });
      };
      if (result && typeof result.then === "function") {
        return result.then(
          (v) => { finalize(); return v; },
          (e) => {
            const duration_ms = Date.now() - t0;
            emit("error", component, `phase ${name} fail`, { phase: name, event: "end", duration_ms, error: e.message });
            throw e;
          }
        );
      }
      finalize();
      return result;
    },
  };
}

// Default singleton pro kvazi-globální použití
export const log = mkLogger({ component: "aisha" });
