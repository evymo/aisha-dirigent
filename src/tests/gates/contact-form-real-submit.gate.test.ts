/**
 * Gate: contact forms persist for real (no fake submit).
 *
 * The contact/quote forms — the `contact-form` runtime block embedded in seeded
 * web templates, and the marketing CTASection — must POST to the real
 * `capture_lead` RPC via the `useSubmitLead` hook. They previously *simulated*
 * a submit with a `setTimeout` that showed a success toast and persisted
 * nothing. This gate prevents that fake-functionality pattern from returning
 * and asserts the full persistence path exists end-to-end:
 *
 *   1. Both form components import + call useSubmitLead and .mutate(...).
 *   2. Neither contains a `setTimeout` (the fake delay-then-toast signature).
 *   3. The useSubmitLead hook calls the capture_lead RPC.
 *   4. capture_lead SoT: SECURITY DEFINER, SET search_path, anon-granted,
 *      inserts into lead_submissions (the only public write path).
 *   5. lead_submissions table SoT: RLS enabled (anon never writes directly).
 *
 * All checks are static (file reads + regex) so the gate runs offline.
 *
 * @module
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

const FORM_COMPONENTS = [
  "src/components/web/blocks/ContactFormBlock.tsx",
  "src/components/sections/CTASection.tsx",
];

describe("contact-form real-submit gate", () => {
  it.each(FORM_COMPONENTS)("%s uses the real useSubmitLead path", (rel) => {
    const src = read(rel);
    expect(src, `${rel}: must import useSubmitLead`).toMatch(
      /import\s*\{\s*useSubmitLead\s*\}\s*from\s*["']@\/hooks\/useSubmitLead["']/,
    );
    expect(src, `${rel}: must call useSubmitLead()`).toMatch(/useSubmitLead\s*\(/);
    expect(src, `${rel}: must dispatch the mutation`).toMatch(/\.mutate\s*\(/);
  });

  it.each(FORM_COMPONENTS)("%s has no fake setTimeout submit", (rel) => {
    const src = read(rel);
    expect(src, `${rel}: setTimeout is the fake-submit signature — use the real RPC`).not.toMatch(
      /setTimeout\s*\(/,
    );
  });

  it("useSubmitLead calls the capture_lead RPC", () => {
    const src = read("src/hooks/useSubmitLead.ts");
    expect(src).toMatch(/aisha\.rpc\(\s*["']capture_lead["']/);
  });

  it("capture_lead SoT is a hardened, anon-granted definer that writes lead_submissions", () => {
    const fn = read("aisha/db/sql/functions/capture_lead.sql");
    expect(fn, "SECURITY DEFINER").toMatch(/SECURITY\s+DEFINER/i);
    expect(fn, "SET search_path").toMatch(/SET\s+search_path/i);
    expect(fn, "granted to anon").toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.capture_lead[\s\S]*TO\s+anon/i);
    expect(fn, "REVOKE FROM PUBLIC").toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.capture_lead[\s\S]*FROM\s+PUBLIC/i);
    expect(fn, "inserts into lead_submissions").toMatch(/INSERT\s+INTO\s+public\.lead_submissions/i);
  });

  it("lead_submissions table SoT enables RLS (no direct anon writes)", () => {
    const tbl = read("aisha/db/sql/tables/lead_submissions.sql");
    expect(tbl).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.lead_submissions/i);
    expect(tbl).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
