/**
 * n8n Drift Observer Workflow Gate
 *
 * Ověřuje strukturu `WF_DRIFT_OBSERVER.json`:
 *   1. Valid JSON, required nodes, dual triggers (cron + webhook)
 *   2. exec sandbox node calls svc-agent-runner s correct recipe
 *   3. Classifier produces 5 severity levels
 *   4. 5 action branches (auto-fix, re-create, security alert, critical alert, log)
 *   5. Auto-fix branches use exec sandbox (ne přímý API call)
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { N8nNode, N8nWorkflow, N8nConnectionTarget } from "./_types";
import { requireNode } from "./_n8n-helpers";
// Jména instancí a tvar nálezu z JEDNOHO domova (lib/jmena-instanci.ts):
// ⛔ NAMĚŘENO 2026-09-12: tady stálo `.not.toMatch(/aisha-|<fork>-/)` — jméno
// JEDNÉ skutečné instance opsané do generické brány. Vzorek: sedmá instance
// projde. `aisha-` je literál platformy (třída squattingu #163) a měří se
// vždy; jména instancí přicházejí z téhož zdroje jako ve stack bráně, a bez
// nich se to hlásí jako NEZMĚŘENO, ne jako zelená.
import { VZOR_PLATFORMY, duvodNezmereno, najdiJmena, znamaJmenaInstanci } from "./lib/jmena-instanci";

const ZNAMA = await znamaJmenaInstanci();
const NEZMERENO = duvodNezmereno(ZNAMA);

const ROOT = process.cwd();
const WF_PATH = join(ROOT, "n8n/workflows/WF_DRIFT_OBSERVER.json");

let wf: N8nWorkflow;

describe("WF_DRIFT_OBSERVER.json — structure", () => {
  test("file exists and is valid JSON", () => {
    expect(existsSync(WF_PATH)).toBe(true);
    const content = readFileSync(WF_PATH, "utf-8");
    expect(() => { wf = JSON.parse(content); }).not.toThrow();
  });

  test("is event-driven: single webhook trigger, NO cron/schedule nodes", () => {
    const webhook = requireNode(wf, (n) => n.id === "wh-drift");
    expect(webhook.type).toBe("n8n-nodes-base.webhook");
    expect(webhook.parameters.path).toBe("drift-now");
    // Critical: no scheduled triggers — drift fires only on events
    const scheduled = wf.nodes.filter((n: N8nNode) => n.type === "n8n-nodes-base.scheduleTrigger");
    expect(scheduled.length).toBe(0);
  });

  test("documents event sources (callers of /webhook/drift-now)", () => {
    const eventSources = wf.meta?.event_sources;
    expect(eventSources).toBeDefined();
    expect(Array.isArray(eventSources)).toBe(true);
    // At least 3 documented event sources
    expect(eventSources?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  test("has all action nodes for severity-driven routing", () => {
    const ids = wf.nodes.map((n: N8nNode) => n.id);
    const required = [
      "wh-drift",
      "parse-trigger",
      "run-drift-check",
      "parse-drift",
      "route",
      "auto-fix-compose",
      "trigger-create-missing",
      "alert-security",
      "alert-critical",
      "log-clean",
      "respond",
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  test("parse-trigger preserves caller context (reason, app, story)", () => {
    const node = requireNode(wf, (n) => n.id === "parse-trigger");
    const code = node.parameters.jsCode;
    expect(code).toContain("reason");
    expect(code).toContain("app");
    expect(code).toContain("story");
    expect(code).toContain("trigger_source");
  });

  test("drift check uses exec sandbox (svc-agent-runner)", () => {
    const node = requireNode(wf, (n) => n.id === "run-drift-check");
    expect(node.type).toBe("n8n-nodes-base.httpRequest");
    // ⛔ NAMĚŘENO 2026-08-19: tady stálo `toContain("svc-agent-runner")`, což
    // sedělo jen na URL psanou NATVRDO (`http://aisha-svc-agent-runner:3030`) —
    // tedy na službu CIZÍ instance. Adresa se teď bere z prostředí, takže se
    // měří TO: uzel ji odvozuje a nejmenuje instanci.
    expect(node.parameters.url, "adresa runneru se bere z prostředí").toContain("$env.AGENT_RUNNER_URL");
    expect(node.parameters.url, "a nesmí nést jméno platformy (`aisha-<služba>` je cizí kontejner na sdíleném hostiteli, #163)").not.toMatch(VZOR_PLATFORMY);
    expect(node.parameters.url).toContain("/exec");
    expect(node.parameters.jsonBody).toContain("system/coolify-drift-check");
  });

  test("classifier produces 5 severity levels", () => {
    const node = requireNode(wf, (n) => n.id === "parse-drift");
    const code = node.parameters.jsCode;
    const severities = ["clean", "medium", "high", "critical", "security_concern"];
    for (const s of severities) {
      expect(code).toContain(s);
    }
  });

  test("classifier counts all 4 drift categories", () => {
    const node = requireNode(wf, (n) => n.id === "parse-drift");
    const code = node.parameters.jsCode;
    expect(code).toContain("orphaned");
    expect(code).toContain("missing");
    expect(code).toContain("composeDrift");
    expect(code).toContain("serverDrift");
  });

  test("auto-fix-compose branch calls exec sandbox with --fix-compose", () => {
    const node = requireNode(wf, (n) => n.id === "auto-fix-compose");
    // ⛔ NAMĚŘENO 2026-08-19: tady stálo `toContain("svc-agent-runner")`, což
    // sedělo jen na URL psanou NATVRDO (`http://aisha-svc-agent-runner:3030`) —
    // tedy na službu CIZÍ instance. Adresa se teď bere z prostředí, takže se
    // měří TO: uzel ji odvozuje a nejmenuje instanci.
    expect(node.parameters.url, "adresa runneru se bere z prostředí").toContain("$env.AGENT_RUNNER_URL");
    expect(node.parameters.url, "a nesmí nést jméno platformy (`aisha-<služba>` je cizí kontejner na sdíleném hostiteli, #163)").not.toMatch(VZOR_PLATFORMY);
    expect(node.parameters.jsonBody).toContain("--fix-compose");
  });

  test.skipIf(NEZMERENO !== null)(
    `adresy runneru nejmenují žádnou známou instanci${NEZMERENO ? ` — NEZMĚŘENO: ${NEZMERENO}` : ""}`,
    () => {
      for (const id of ["run-drift-check", "auto-fix-compose"]) {
        const node = requireNode(wf, (n) => n.id === id);
        expect(
          najdiJmena(node.parameters.url ?? "", ZNAMA.jmena).map((n) => n.text),
          `${id}: adresa nese jméno instance; instance, které brána zná: ${ZNAMA.jmena.join(", ")}`,
        ).toEqual([]);
      }
    },
  );

  // Fixtura `testfork`: měřidlo se měří samo — adresa se jménem instance by
  // zčervenala, odvozená z prostředí ne, a literál platformy se chytá vždy.
  test("negativní sonda: `http://testfork-…` by zčervenalo, `$env.AGENT_RUNNER_URL` ne, `aisha-` vždy", () => {
    expect(najdiJmena("http://testfork-svc-agent-runner:3030/exec", ["testfork"]).length).toBe(1);
    expect(najdiJmena("={{ $env.AGENT_RUNNER_URL }}/exec", ["testfork"])).toEqual([]);
    expect("http://aisha-svc-agent-runner:3030/exec").toMatch(VZOR_PLATFORMY);
    expect("={{ $env.AGENT_RUNNER_URL }}/exec").not.toMatch(VZOR_PLATFORMY);
  });

  test("re-create missing apps branch calls coolify-story-init recipe", () => {
    const node = requireNode(wf, (n) => n.id === "trigger-create-missing");
    expect(node.parameters.jsonBody).toContain("system/coolify-story-init");
  });

  test("security alert (orphans) is alert-only, NEVER auto-delete", () => {
    const node = requireNode(wf, (n) => n.id === "alert-security");
    const code = node.parameters.jsCode;
    expect(code).toContain("security_alert");
    // Critical: must NOT contain auto-delete logic — orphans need operator review
    expect(code).not.toContain("DELETE");
    expect(code).not.toContain("auto_delete");
  });

  test("server drift is critical alert, ne auto-action (destruktivní)", () => {
    const node = requireNode(wf, (n) => n.id === "alert-critical");
    const code = node.parameters.jsCode;
    expect(code).toContain("critical_alert");
    expect(code).toContain("manual migration");
  });

  test("all branches lead to respond node", () => {
    const branches = ["Auto-fix compose drift", "Re-create missing apps", "Security alert (orphans)", "Critical alert (server drift)", "Log clean state"];
    for (const branch of branches) {
      const conn = wf.connections[branch];
      expect(conn).toBeDefined();
      const targets = (conn.main ?? [])[0].map((c: N8nConnectionTarget) => c.node);
      expect(targets).toContain("Respond");
    }
  });

  test("workflow tagged for AISHA + event-driven (NOT scheduled)", () => {
    expect(wf.tags).toContain("aisha");
    expect(wf.tags).toContain("drift");
    expect(wf.tags).toContain("self-driving");
    expect(wf.tags).toContain("event-driven");
    expect(wf.tags).not.toContain("scheduled");
  });
});
