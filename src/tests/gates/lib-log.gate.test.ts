/**
 * lib/log.mjs Gate — structured logger contract
 *
 * Ověřuje:
 *   1. mkLogger() vrací objekt s metodami debug/info/warn/error/phase
 *   2. JSON mode (AISHA_LOG_JSON=1) emituje valid JSON Lines na stderr
 *   3. Level filtering (AISHA_LOG_LEVEL) respektuje precedence
 *   4. Phase wrapping měří duration_ms a emituje start+end events
 *   5. Pretty mode obsahuje očekávané symboly (ℹ ⚠ ✗) a key=value pairs
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const LOG = join(ROOT, "scripts/lib/log.mjs");

// Helper — spustí Node inline skript s log.mjs importem, vrátí captured stderr
function runWithLog(script: string, env: Record<string, string> = {}): string {
  try {
    execFileSync("node", ["--input-type=module", "-e", script], {
      cwd: ROOT,
      env: { ...process.env, ...env, NODE_OPTIONS: "" },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return ""; // log writes to stderr; on success exec returns stdout (empty)
  } catch (e: unknown) {
    // execFileSync throws on non-zero exit; we want to capture stderr regardless
    const err = e as { stderr?: Buffer | string };
    return err.stderr?.toString() || "";
  }
}

// Run successfully but capture stderr
function captureStderr(script: string, env: Record<string, string> = {}): string {
  const result = execFileSync("node", ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, ...env, NODE_OPTIONS: "" },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // execFileSync only returns stdout. We need stderr — switch to spawnSync.
  return result;
}

import { spawnSync } from "node:child_process";

function runScript(script: string, env: Record<string, string> = {}): { stdout: string; stderr: string; code: number } {
  const r = spawnSync("node", ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, ...env, NODE_OPTIONS: "" },
    encoding: "utf-8",
  });
  return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 0 };
}

describe("lib/log.mjs — API contract", () => {
  test("mkLogger returns object with debug/info/warn/error/phase methods", () => {
    const r = runScript(`
      import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "test" });
      console.log(JSON.stringify({
        debug: typeof log.debug,
        info: typeof log.info,
        warn: typeof log.warn,
        error: typeof log.error,
        phase: typeof log.phase,
      }));
    `);
    expect(r.code).toBe(0);
    const api = JSON.parse(r.stdout.trim());
    expect(api.debug).toBe("function");
    expect(api.info).toBe("function");
    expect(api.warn).toBe("function");
    expect(api.error).toBe("function");
    expect(api.phase).toBe("function");
  });
});

describe("lib/log.mjs — JSON mode", () => {
  test("AISHA_LOG_JSON=1 produces valid JSON Lines on stderr", () => {
    const r = runScript(
      `import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "ut" });
      log.info("hello", { x: 1, y: "two" });
      log.warn("warn msg", { code: 42 });
      log.error("err msg");`,
      { AISHA_LOG_JSON: "1" }
    );
    expect(r.code).toBe(0);
    const lines = r.stderr.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(["debug", "info", "warn", "error"]).toContain(obj.level);
      expect(obj.component).toBe("ut");
      expect(typeof obj.msg).toBe("string");
    }
    const first = JSON.parse(lines[0]);
    expect(first.level).toBe("info");
    expect(first.x).toBe(1);
    expect(first.y).toBe("two");
  });

  test("level filtering: AISHA_LOG_LEVEL=warn drops debug/info", () => {
    const r = runScript(
      `import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "ut" });
      log.debug("dropped");
      log.info("dropped");
      log.warn("kept");
      log.error("kept");`,
      { AISHA_LOG_JSON: "1", AISHA_LOG_LEVEL: "warn" }
    );
    expect(r.code).toBe(0);
    const lines = r.stderr.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });
});

describe("lib/log.mjs — Pretty mode", () => {
  test("default mode contains symbols + component tag + key=value", () => {
    const r = runScript(
      `import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "tst" });
      log.info("hello", { k: "v" });
      log.warn("careful");
      log.error("boom");`,
      {}
    );
    expect(r.code).toBe(0);
    // Strip ANSI escape codes for stable matching
    // eslint-disable-next-line no-control-regex
    const plain = r.stderr.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toMatch(/ℹ\s+\[tst\]\s+hello\s+k=v/);
    expect(plain).toMatch(/⚠\s+\[tst\]\s+careful/);
    expect(plain).toMatch(/✗\s+\[tst\]\s+boom/);
  });
});

describe("lib/log.mjs — Phase wrapping", () => {
  test("phase() emits start + end with duration_ms", () => {
    const r = runScript(
      `import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "ut" });
      log.phase("test_phase", () => { for (let i = 0; i < 1e5; i++); });`,
      { AISHA_LOG_JSON: "1" }
    );
    expect(r.code).toBe(0);
    const lines = r.stderr.trim().split("\n").map((l) => JSON.parse(l));
    const start = lines.find((l) => l.event === "start");
    const end = lines.find((l) => l.event === "end");
    expect(start).toBeDefined();
    expect(start.phase).toBe("test_phase");
    expect(end).toBeDefined();
    expect(end.phase).toBe("test_phase");
    expect(typeof end.duration_ms).toBe("number");
    expect(end.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("phase() handles async functions and emits error on rejection", async () => {
    const r = runScript(
      `import { mkLogger } from "${LOG}";
      const log = mkLogger({ component: "ut" });
      try {
        await log.phase("fail_phase", async () => { throw new Error("kaboom"); });
      } catch {}`,
      { AISHA_LOG_JSON: "1" }
    );
    expect(r.code).toBe(0);
    const lines = r.stderr.trim().split("\n").map((l) => JSON.parse(l));
    const errLine = lines.find((l) => l.level === "error");
    expect(errLine).toBeDefined();
    expect(errLine.phase).toBe("fail_phase");
    expect(errLine.error).toBe("kaboom");
  });
});
