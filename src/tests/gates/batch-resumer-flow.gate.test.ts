/**
 * Batch Resumer Flow — Gate Tests
 *
 * Locks in the structural contract for the batch resumption flow:
 *   1. SoT RPCs exist in aisha/db/sql/functions/ (paired with migration)
 *   2. Migration registers both RPCs with proper auth/grants
 *   3. WF_BATCH_RESUMER workflow exists + has all required nodes
 *   4. svc-ai-chat exposes POST /reflect/runs/:id/resume-batch
 *   5. orchestrator exports resumeAfterBatch
 *
 * Without all 5 pieces wired, batch runs end in 'waiting_batch' indefinitely.
 * This gate makes drift impossible — break any piece and the gate fails.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("Batch Resumer Flow — structural integrity", () => {
  // ── SoT layer ──────────────────────────────────────────────────────────────
  it("SoT: get_completed_batches_pending_resume.sql exists with proper auth", () => {
    const sot = readFile(
      "aisha/db/sql/functions/get_completed_batches_pending_resume.sql",
    );
    expect(sot.length, "SoT function must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/SET\s+search_path\s+TO\s+'public'/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/);
  });

  it("SoT: persist_batch_result_and_resume.sql exists with proper auth", () => {
    const sot = readFile(
      "aisha/db/sql/functions/persist_batch_result_and_resume.sql",
    );
    expect(sot.length, "SoT function must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/);
  });

  it("SoT: persist_batch_result_and_resume is IDEMPOTENT (handles status != waiting_batch)", () => {
    const sot = readFile(
      "aisha/db/sql/functions/persist_batch_result_and_resume.sql",
    );
    // Must check run status before mutating — otherwise concurrent resumers
    // would double-apply the result + audit twice.
    expect(
      stripSqlComments(sot),
      "RPC must check v_run.status against 'waiting_batch' and set already_resumed when it doesn't match",
    ).toMatch(/v_run\.status\s*!=\s*'waiting_batch'/);
    expect(
      stripSqlComments(sot),
      "RPC must return already_resumed flag in output JSON",
    ).toMatch(/'already_resumed'/);
  });

  it("SoT: persist_batch_result_and_resume writes audit_journal action='batch.resumed'", () => {
    const sot = readFile(
      "aisha/db/sql/functions/persist_batch_result_and_resume.sql",
    );
    expect(stripSqlComments(sot)).toMatch(/INSERT\s+INTO\s+audit_journal[\s\S]+'batch\.resumed'/);
  });

  it("SoT: persist_batch_result_and_resume uses row-level lock (FOR UPDATE) to prevent race", () => {
    const sot = readFile(
      "aisha/db/sql/functions/persist_batch_result_and_resume.sql",
    );
    const noComments = stripSqlComments(sot);
    // Both ai_batch_jobs row + ai_runs row must be FOR UPDATE locked so
    // concurrent WF_BATCH_RESUMER invocations don't race on the same batch.
    expect(noComments).toMatch(/FROM\s+ai_batch_jobs[\s\S]+FOR\s+UPDATE/);
    expect(noComments).toMatch(/FROM\s+ai_runs[\s\S]+FOR\s+UPDATE/);
  });

  // ── Migration layer ────────────────────────────────────────────────────────
  it("SoT: batch resumer RPCs defined in canonical function files", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_completed_batches_pending_resume.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/persist_batch_result_and_resume.sql");
    expect(mig.length, "SoT must exist").toBeGreaterThan(100);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_completed_batches_pending_resume/);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.persist_batch_result_and_resume/);
  });

  it("SoT: both RPCs GRANT to service_role only (not other roles)", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_completed_batches_pending_resume.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/persist_batch_result_and_resume.sql");
    const grants = mig.match(/GRANT\s+EXECUTE[\s\S]+?;/g) ?? [];
    expect(grants.length, "Migration should have 2 explicit GRANT statements").toBeGreaterThanOrEqual(2);
    // Neither RPC should grant to anon or authenticated — batch resumer is
    // service-role only (called by n8n with service token, never user JWT).
    for (const grant of grants) {
      expect(grant, `GRANT should not include 'anon' role: ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+anon\b/);
      expect(grant, `GRANT should not include 'authenticated' role: ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+authenticated\b/);
    }
  });

  // ── n8n workflow layer ─────────────────────────────────────────────────────
  it("WF_BATCH_RESUMER.json exists and is valid JSON", () => {
    const wfPath = path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json");
    expect(fs.existsSync(wfPath)).toBe(true);
    const raw = fs.readFileSync(wfPath, "utf-8");
    const parsed = JSON.parse(raw); // throws on invalid JSON → test fails
    expect(parsed.name).toBe("WF_BATCH_RESUMER");
  });

  it("WF_BATCH_RESUMER has all required nodes (scheduleTrigger → list → split → route → fetch → normalize → persist → resume → audit)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json"), "utf-8"),
    );
    const nodeNames = (wf.nodes as Array<{ name: string }>).map((n) => n.name);
    expect(nodeNames, "scheduleTrigger node required (cron)").toContain("Every 5 Minutes");
    expect(nodeNames, "discovery RPC call required").toContain("List Completed Pending Resume");
    expect(nodeNames, "splitOut per batch job required").toContain("Split Per Batch Job");
    expect(nodeNames, "provider switch required").toContain("Route By Provider");
    expect(nodeNames, "anthropic fetch required").toContain("Fetch Anthropic Result");
    expect(nodeNames, "openai fetch required").toContain("Fetch OpenAI Result");
    expect(nodeNames, "normalize code node required").toContain("Normalize Batch Result");
    expect(nodeNames, "persist + flip status required").toContain("Persist Result + Flip Status");
    expect(nodeNames, "orchestrator resume call required").toContain("Resume Orchestrator");
    expect(nodeNames, "audit row required").toContain("Audit Integration Action");
  });

  it("WF_BATCH_RESUMER nodes all have onError configured (no silent failures)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json"), "utf-8"),
    );
    const missing: string[] = [];
    for (const node of wf.nodes as Array<{ name: string; onError?: string }>) {
      if (!node.onError) missing.push(node.name);
    }
    expect(
      missing,
      `Nodes without onError (silent failure risk): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("WF_BATCH_RESUMER scheduleTrigger runs at most every 5 minutes (cron rate-limit)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json"), "utf-8"),
    );
    const trigger = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Every 5 Minutes",
    );
    expect(trigger, "scheduleTrigger node must exist").toBeDefined();
    const rule = (trigger!.parameters as Record<string, unknown>).rule as Record<string, unknown>;
    const interval = (rule.interval as Array<Record<string, unknown>>)[0];
    expect(interval!.field, "must be minutes-based (not seconds)").toBe("minutes");
    expect(
      interval!.minutesInterval as number,
      "5-minute cadence — balances quick resume after batch completion vs n8n run volume",
    ).toBeGreaterThanOrEqual(5);
  });

  it("WF_BATCH_RESUMER persist node calls persist_batch_result_and_resume RPC", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json"), "utf-8"),
    );
    const persist = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Persist Result + Flip Status",
    );
    expect((persist!.parameters as Record<string, unknown>).url).toMatch(
      /persist_batch_result_and_resume/,
    );
  });

  it("WF_BATCH_RESUMER resume node calls svc-ai-chat /reflect/runs/:id/resume-batch", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_BATCH_RESUMER.json"), "utf-8"),
    );
    const resume = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Resume Orchestrator",
    );
    expect((resume!.parameters as Record<string, unknown>).url as string).toMatch(
      /\/reflect\/runs\/.*\/resume-batch/,
    );
  });

  // ── TS service layer ───────────────────────────────────────────────────────
  it("svc-ai-chat orchestrator exports resumeAfterBatch", () => {
    const src = readFile("services/svc-ai-chat/src/reflection/orchestrator.ts");
    expect(src).toMatch(/export\s+async\s+function\s+resumeAfterBatch\s*\(/);
  });

  it("svc-ai-chat reflect route exposes POST /reflect/runs/:id/resume-batch", () => {
    const src = readFile("services/svc-ai-chat/src/routes/reflect.ts");
    // Route registration string + handler imports
    expect(src, "Route path must be defined").toMatch(
      /'\/reflect\/runs\/:id\/resume-batch'/,
    );
    expect(src, "Handler must import resumeAfterBatch").toMatch(/resumeAfterBatch/);
  });

  it("svc-ai-chat resume-batch route requires service-role auth (verifyServiceRole)", () => {
    const src = readFile("services/svc-ai-chat/src/routes/reflect.ts");
    // The route's handler must call verifyServiceRole — same gate as
    // /reflect/runs/:id/approve (no public endpoint for batch resume).
    const routeStartIdx = src.indexOf("'/reflect/runs/:id/resume-batch'");
    expect(routeStartIdx, "route definition must exist").toBeGreaterThan(-1);
    // Within the next ~700 chars (route handler body), verifyServiceRole must be called.
    const routeBody = src.slice(routeStartIdx, routeStartIdx + 700);
    expect(routeBody).toMatch(/verifyServiceRole/);
  });
});
