/**
 * lib/metrics.mjs Gate — Prometheus textfile format compliance
 *
 * Ověřuje:
 *   1. flush() vrací cestu k .prom souboru
 *   2. Output odpovídá Prometheus exposition format:
 *      - každá metric má `# HELP` a `# TYPE` line
 *      - každá metric line má pattern `name{labels} value`
 *   3. Label escaping: backslash, double quote, newline → \\, \", \n
 *   4. Multiple records pro stejnou metric: jeden HELP/TYPE, multiple value lines
 *   5. Counter/gauge/histogram type tagy správné
 *   6. AISHA_METRICS_DISABLE=1 → no-op (žádný .prom soubor)
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const METRICS = join(ROOT, "scripts/lib/legacy/metrics.mjs");
const TMPDIR = join(ROOT, ".tmp/metrics-test");

function runScript(script: string, env: Record<string, string> = {}): { stdout: string; stderr: string; code: number } {
  const r = spawnSync("node", ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, ...env, NODE_OPTIONS: "" },
    encoding: "utf-8",
  });
  return { stdout: r.stdout || "", stderr: r.stderr || "", code: r.status ?? 0 };
}

describe("lib/metrics.mjs — Prometheus format", () => {
  beforeAll(() => {
    if (!existsSync(TMPDIR)) mkdirSync(TMPDIR, { recursive: true });
  });
  afterAll(() => {
    try { rmSync(TMPDIR, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  });

  test("flush() writes valid Prometheus exposition format", () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      metrics.counter("aisha_test_counter", 5, { phase: "step5", result: "success" });
      metrics.gauge("aisha_test_gauge", 42, { app: "keycloak" });
      metrics.histogram("aisha_test_duration_seconds", 12.5, { phase: "deploy" });
      const path = metrics.flush("test1.prom");
      console.log(path);`,
      { AISHA_METRICS_DIR: TMPDIR }
    );
    expect(r.code).toBe(0);
    const path = r.stdout.trim();
    expect(path).toContain("test1.prom");
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, "utf-8");
    // HELP + TYPE per metric
    expect(content).toMatch(/# HELP aisha_test_counter/);
    expect(content).toMatch(/# TYPE aisha_test_counter counter/);
    expect(content).toMatch(/# HELP aisha_test_gauge/);
    expect(content).toMatch(/# TYPE aisha_test_gauge gauge/);

    // Value lines with labels
    expect(content).toMatch(/aisha_test_counter\{phase="step5",result="success"\} 5/);
    expect(content).toMatch(/aisha_test_gauge\{app="keycloak"\} 42/);
    expect(content).toMatch(/aisha_test_duration_seconds\{phase="deploy"\} 12\.5/);
  });

  test("multiple values pro stejnou metric → one HELP/TYPE, multiple value lines", () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      metrics.counter("aisha_multi", 1, { wave: "1" });
      metrics.counter("aisha_multi", 2, { wave: "2" });
      metrics.counter("aisha_multi", 3, { wave: "3" });
      console.log(metrics.flush("test2.prom"));`,
      { AISHA_METRICS_DIR: TMPDIR }
    );
    expect(r.code).toBe(0);
    const content = readFileSync(r.stdout.trim(), "utf-8");
    // Exactly ONE HELP + ONE TYPE
    expect((content.match(/# HELP aisha_multi/g) || []).length).toBe(1);
    expect((content.match(/# TYPE aisha_multi/g) || []).length).toBe(1);
    // THREE value lines
    expect(content).toMatch(/aisha_multi\{wave="1"\} 1/);
    expect(content).toMatch(/aisha_multi\{wave="2"\} 2/);
    expect(content).toMatch(/aisha_multi\{wave="3"\} 3/);
  });

  test("label escaping: quote/backslash/newline are escaped per Prometheus spec", () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      metrics.counter("aisha_esc", 1, { msg: 'with "quote" and \\\\backslash and\\nnewline' });
      console.log(metrics.flush("test3.prom"));`,
      { AISHA_METRICS_DIR: TMPDIR }
    );
    expect(r.code).toBe(0);
    const content = readFileSync(r.stdout.trim(), "utf-8");
    // \" should be escaped, \\ should be doubled, \n should be \n literal
    expect(content).toMatch(/msg="with \\"quote\\" and \\\\backslash and\\nnewline"/);
  });

  test("AISHA_METRICS_DISABLE=1 produces no file", () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      metrics.counter("aisha_disabled", 1);
      const path = metrics.flush("test-disabled.prom");
      console.log("path:", path);`,
      { AISHA_METRICS_DIR: TMPDIR, AISHA_METRICS_DISABLE: "1" }
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("path: null");
    expect(existsSync(join(TMPDIR, "test-disabled.prom"))).toBe(false);
  });

  test("phase() helper measures duration + emits both counter and histogram", async () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      await metrics.phase("foo", { app: "test" }, async () => {
        await new Promise((res) => setTimeout(res, 50));
      });
      console.log(metrics.flush("test-phase.prom"));`,
      { AISHA_METRICS_DIR: TMPDIR }
    );
    expect(r.code).toBe(0);
    const content = readFileSync(r.stdout.trim(), "utf-8");
    // Should have both phase_total counter + phase_duration_seconds gauge
    expect(content).toMatch(/aisha_cold_start_phase_total\{phase="foo",result="success",app="test"\} 1/);
    expect(content).toMatch(/aisha_cold_start_phase_duration_seconds\{phase="foo",result="success",app="test"\} \d+\.\d+/);
  });

  test("phase() with throw emits result=error", async () => {
    const r = runScript(
      `import { metrics } from "${METRICS}";
      try {
        await metrics.phase("fails", {}, async () => { throw new Error("nope"); });
      } catch { /* cleanup best-effort */ }
      console.log(metrics.flush("test-fail-phase.prom"));`,
      { AISHA_METRICS_DIR: TMPDIR }
    );
    expect(r.code).toBe(0);
    const content = readFileSync(r.stdout.trim(), "utf-8");
    expect(content).toMatch(/aisha_cold_start_phase_total\{phase="fails",result="error"\} 1/);
  });
});
