/**
 * get_workflow_my_steps_block × include_done_today — the driver's tape needs a
 * "done today" section (and the day's mined rewards) next to the pending queue.
 *
 * Contract-safe by construction: a completed item goes out as
 * state='human_confirmed', which is ALREADY in the review_queue fieldState enum —
 * the platform schema does not change. Ordering: pending first (those are the
 * actions), completed last in confirmation order; `limit` spans both predictably.
 * "Done today" is a property of the STEP (completed_at), not the run: a run dated
 * yesterday but confirmed today belongs in today's done group even with due:today.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

function svc(sql: string): string {
  const wrapped =
    `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n${sql};`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: wrapped, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Tape done-today test ${RUN}`;
const UID = randomUUID(); // řidičův účet — viditelnost přes potvrzenou twin vazbu

/** Blok vyhodnocený POD účtem řidiče (authenticated claims, sub = UID). */
interface QueueItem { id: string; quote?: string; state: string }

function block(params: Record<string, unknown>): { items: QueueItem[]; trace: string } {
  const claims = JSON.stringify({ role: "authenticated", sub: UID });
  const out = execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`
        + `SELECT public.get_workflow_my_steps_block('${JSON.stringify(params)}'::jsonb);`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
  const parsed = JSON.parse(out);
  return { items: parsed.data.items, trace: parsed.provenance.trace_id };
}

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO public.production_workflow_templates (name, description, workflow_steps, is_active)
       SELECT '${TEMPLATE}', 'tape test', '[
         {"step_code":"predej","step_name":"Handover","step_order":1,"assigned_role":"production_operator"}
       ]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);
  // Tři běhy pod týmž twinem: čekající dnes · dokončený dnes · dokončený VČERA.
  for (const [code, label] of [["p1", "pending"], ["d1", "done-today"], ["d0", "done-old"]]) {
    svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'tape-${RUN}-${code}',
           '${label}', current_date, '{"dl_number":"${code.toUpperCase()}"}'::jsonb,
           '{"predej":{"authorized_twin_ref":{"entity_type":"person","source":"tape-${RUN}","source_key":"D-1","label":"Driver"}}}'::jsonb)`);
  }
  const twin = svc(`SELECT r.twin_id FROM public.twin_external_refs r
                     WHERE r.source='tape-${RUN}' AND r.source_key='D-1' AND r.ref_kind='primary_id' LIMIT 1`);
  // ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10) — dřív tu byl náhradní slug a CHECK ho odmítl.
  svc(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
       VALUES ('${twin}', 'aisha_auth', '${UID}', 'account', 'confirmed', 'test', now())`);
  // Dokončení: d1 dnes, d0 včera (vlastnost KROKU, běhy mají production_date dnes).
  svc(`UPDATE public.production_workflow_steps s SET status='completed', completed_at=now()
        FROM public.production_batches b WHERE b.id=s.batch_id AND b.batch_code='tape-${RUN}-d1'`);
  svc(`UPDATE public.production_workflow_steps s SET status='completed', completed_at=now()-interval '1 day'
        FROM public.production_batches b WHERE b.id=s.batch_id AND b.batch_code='tape-${RUN}-d0'`);
});

const CFG = { step_code: "predej", due: "today", quote_src: "input:dl_number", limit: 50 };

describe("get_workflow_my_steps_block × include_done_today", () => {
  it.skipIf(!dbAvailable)("default stays pending-only (existing consumers unchanged)", () => {
    const { items, trace } = block(CFG);
    const quotes = items.map((i) => i.quote);
    expect(quotes).toContain("P1");
    expect(quotes).not.toContain("D1");
    expect(items.every((i) => i.state === "needs_review")).toBe(true);
    expect(trace).not.toContain(":done-today");
  });

  it.skipIf(!dbAvailable)("adds ONLY today's completions, pending first, done marked", () => {
    const { items, trace } = block({ ...CFG, include_done_today: true });
    const byQuote = Object.fromEntries(items.map((i) => [i.quote, i]));
    expect(byQuote.P1.state).toBe("needs_review");
    expect(byQuote.D1.state).toBe("human_confirmed"); // hodnota z existujícího výčtu
    expect(byQuote.D0).toBeUndefined(); // včerejší dokončení do dnešní pásky nepatří
    expect(items.findIndex((i) => i.quote === "P1"))
      .toBeLessThan(items.findIndex((i) => i.quote === "D1")); // fronta před hotovem
    expect(trace).toContain(":done-today");
  });
});
