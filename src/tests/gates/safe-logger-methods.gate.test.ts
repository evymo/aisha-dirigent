/**
 * Safe-logger method-name gate — createSafeLogger crash prevention.
 *
 * `createSafeLogger` (packages/security/src/logger.ts) returns an object that
 * exposes ONLY:
 *     safeInfo(msg, ctx?)   safeWarn(msg, ctx?)   safeError(msg, err, ctx?)
 *
 * Calling pino-style methods on it — `log.info` / `log.warn` / `log.error` /
 * `log.debug` / … — throws `log.error is not a function` AT RUNTIME. Because
 * logging almost always lives on the error path, the crash is LATENT: tsc and
 * the happy-path tests pass, then the service dies the first time it tries to
 * log a failure.
 *
 * This exact bug shipped in the ACS layer (#678 — every error path in
 * guard.ts / generation.ts / intent.ts / acsInbound.ts used log.warn/log.error).
 * A unit test never exercised those catch blocks, so nothing caught it until a
 * hand-written fail-closed test finally ran one. This gate catches the whole
 * class statically, for every future consumer.
 *
 * Runs via: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["services", "packages", "src"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "__snapshots__",
  ".turbo",
]);

/** Methods createSafeLogger does NOT expose — calling any of them is a crash. */
const WRONG_METHODS = ["info", "warn", "error", "debug", "trace", "fatal"] as const;
const SUGGEST: Record<string, string> = {
  info: "safeInfo",
  warn: "safeWarn",
  error: "safeError",
  debug: "safeInfo",
  trace: "safeInfo",
  fatal: "safeError",
};

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTsFiles(full, acc);
    } else if (
      entry.isFile() &&
      /\.[cm]?ts$/.test(entry.name) &&
      !/\.(test|spec)\.[cm]?ts$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Flag pino-style calls on a `createSafeLogger` binding. Only matches the exact
 * identifier bound to createSafeLogger (a negative look-behind keeps
 * `req.log.error` / `app.log.warn` — Fastify/pino loggers — from false-firing).
 * Exported so the self-test can exercise it directly.
 */
export function findLoggerViolations(content: string, relFile = "<mem>"): string[] {
  if (!/createSafeLogger\s*\(/.test(content)) return [];
  const violations: string[] = [];
  const binds = content.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createSafeLogger\s*\(/g,
  );
  const seen = new Set<string>();
  for (const bind of binds) {
    const name = bind[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const re = new RegExp(
      `(?<![.\\w$])${name}\\.(${WRONG_METHODS.join("|")})\\s*\\(`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      const method = m[1];
      violations.push(
        `${relFile}:${line}: ${name}.${method}(…) — use ${name}.${SUGGEST[method]}(message, …) ` +
          `(createSafeLogger has no .${method}())`,
      );
    }
  }
  return violations;
}

describe("Safe-logger method names (createSafeLogger crash prevention)", () => {
  it("self-test: detector flags wrong methods, ignores the safe API + foreign loggers", () => {
    const bad = `const log = createSafeLogger('x');\nlog.error({ e }, 'boom');\nlog.warn('w');`;
    expect(findLoggerViolations(bad)).toHaveLength(2);

    const good = `const log = createSafeLogger('x');\nlog.safeError('boom', e);\nlog.safeWarn('w');\nlog.safeInfo('i');`;
    expect(findLoggerViolations(good)).toEqual([]);

    // A Fastify/pino logger in the same file must NOT be flagged.
    const mixed = `const log = createSafeLogger('x');\nlog.safeInfo('ok');\nreq.log.error('fastify');\napp.log.warn('x');`;
    expect(findLoggerViolations(mixed)).toEqual([]);

    // Files that never call createSafeLogger are ignored entirely.
    expect(findLoggerViolations(`const log = pino();\nlog.error('ok');`)).toEqual([]);
  });

  it("no createSafeLogger result calls pino-style methods (they crash at runtime)", () => {
    const files = SCAN_DIRS.flatMap((dir) => walkTsFiles(path.join(ROOT, dir)));
    const violations = files.flatMap((file) =>
      findLoggerViolations(readFileSync(file, "utf-8"), path.relative(ROOT, file)),
    );
    expect(
      violations,
      `createSafeLogger exposes ONLY safeInfo / safeWarn / safeError ` +
        `(packages/security/src/logger.ts). The calls below throw ` +
        `"…is not a function" the first time the error path runs:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });
});
