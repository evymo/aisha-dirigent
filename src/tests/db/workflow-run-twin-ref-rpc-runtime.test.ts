/**
 * ensure_workflow_run_for_subject — authorized_twin_ref → authorized_twin_id.
 *
 * The declarant of a run (an ingest bundle) cannot know platform twin UUIDs, so
 * the binding contract accepts a REFERENCE {entity_type, source, source_key,
 * label?} and this function translates it via twin_upsert_entity_audited
 * (idempotent mint-or-match on the source's confirmed primary identity).
 *
 * Properties locked here:
 *  1. resolution: ref becomes authorized_twin_id on the step, role is dropped
 *     (a bound node visible to every role holder would make binding a no-op);
 *  2. convergence: a pre-existing twin with the same (source, source_key) is
 *     REUSED — the run lane and the entity-profile lane must meet on one twin;
 *  3. no half-change: an invalid ref refuses the WHOLE run BEFORE the batch
 *     exists (a run created without its binding could never be re-bound —
 *     ensure_* is idempotent and returns already_open unchanged);
 *  4. visibility stays ratification-gated: the minted twin alone does NOT show
 *     the step to anyone — only a CONFIRMED ref_kind='account' binding does
 *     (workflow_step_visible_to), pending is not enough;
 *  5. metadata of an existing twin survives resolution (NULL is passed — the
 *     twin_upsert UPDATE branch would otherwise overwrite profile-lane evidence).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

/**
 * psql with service_role JWT claims (the drain's identity). The SET's output is
 * routed to /dev/null via \o so only the final statement's value is emitted —
 * a leading "SET" command tag would corrupt JSON.parse of the result.
 */
function svc(sql: string): string {
  const wrapped =
    `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n${sql};`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: wrapped, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

/** Unique per-invocation suffix: reruns against a kept DB must never collide. */
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Twin-ref runtime test process ${RUN}`;
const SRC = `twinref-test-${RUN}`;
const REF = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    handover: {
      authorized_twin_ref: {
        entity_type: "person",
        source: SRC,
        source_key: "K-1",
        label: "Test Person",
        ...over,
      },
    },
  });

beforeAll(async () => {
  await reportTestCapabilities("workflow run twin-ref binding");
  if (!dbAvailable) return;
  svc(`INSERT INTO public.production_workflow_templates (name, description, workflow_steps, is_active)
       SELECT '${TEMPLATE}', 'runtime test', '[
         {"step_code":"load","step_name":"Load","step_order":1,"assigned_role":"production_operator"},
         {"step_code":"handover","step_name":"Handover","step_order":2,"assigned_role":"production_operator"}
       ]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);
});

describe("ensure_workflow_run_for_subject × authorized_twin_ref", () => {
  it.skipIf(!dbAvailable)("resolves the ref, drops the role, and stays idempotent", () => {
    const out = JSON.parse(
      svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'twinref-${RUN}-1',
             'subject one', NULL, '{"what":"gravel"}'::jsonb, '${REF()}'::jsonb)`),
    );
    expect(out.ok).toBe(true);
    expect(out.twin_refs_resolved).toBe(1);

    const step = svc(
      `SELECT coalesce(s.assigned_role,'<null>') || '|' ||
              coalesce(s.input_data->>'authorized_twin_id','<none>') || '|' ||
              coalesce(s.input_data->>'what','<none>') || '|' ||
              coalesce((s.input_data ? 'authorized_twin_ref')::text,'false')
         FROM public.production_workflow_steps s
         JOIN public.production_batches b ON b.id = s.batch_id
        WHERE b.batch_code = 'twinref-${RUN}-1' AND s.step_code = 'handover'`,
    );
    const [role, twinId, what, refLeaked] = step.split("|");
    expect(role).toBe("<null>"); // bound node must lose its role
    expect(twinId).toMatch(/^[0-9a-f-]{36}$/);
    expect(what).toBe("gravel"); // subject flowed into input_data
    expect(refLeaked).toBe("false"); // the raw ref does not leak into the step

    // the twin exists with a confirmed primary identity under the declared key
    const twin = svc(
      `SELECT t.entity_type || '|' || t.label || '|' || r.state
         FROM public.twin_external_refs r JOIN public.twin_entities t ON t.id = r.twin_id
        WHERE r.source = '${SRC}' AND r.source_key = 'K-1' AND r.ref_kind = 'primary_id'`,
    );
    expect(twin).toBe("person|Test Person|confirmed");

    // idempotence: same run_code returns unchanged, no second twin, no re-resolve
    const again = JSON.parse(
      svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'twinref-${RUN}-1',
             NULL, NULL, '{}'::jsonb, '${REF()}'::jsonb)`),
    );
    expect(again.already_open).toBe(true);
    expect(
      svc(`SELECT count(*) FROM public.twin_external_refs
            WHERE source='${SRC}' AND source_key='K-1' AND ref_kind='primary_id'`),
    ).toBe("1");
  });

  it.skipIf(!dbAvailable)("reuses a pre-existing twin with the same (source, source_key)", () => {
    const existing = svc(
      `SELECT (public.twin_upsert_entity_audited('person','${SRC}','K-2','Existing P',
               NULL,'{"evidence":"profile-lane"}'::jsonb))->>'twin_id'`,
    );
    const out = JSON.parse(
      svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'twinref-${RUN}-2',
             NULL, NULL, '{}'::jsonb,
             '${REF({ source_key: "K-2", label: "Existing P" })}'::jsonb)`),
    );
    expect(out.ok).toBe(true);
    const bound = svc(
      `SELECT s.input_data->>'authorized_twin_id'
         FROM public.production_workflow_steps s
         JOIN public.production_batches b ON b.id = s.batch_id
        WHERE b.batch_code = 'twinref-${RUN}-2' AND s.step_code = 'handover'`,
    );
    expect(bound).toBe(existing); // convergence, not a duplicate twin
    // resolution passes NULL metadata — profile-lane evidence must survive
    expect(
      svc(`SELECT t.metadata->>'evidence' FROM public.twin_entities t WHERE t.id = '${existing}'`),
    ).toBe("profile-lane");
  });

  it.skipIf(!dbAvailable)("refuses an invalid ref BEFORE creating the run (no half-change)", () => {
    for (const [bindings, hint] of [
      [REF({ typo_key: "x" }), "unknown authorized_twin_ref keys"],
      [REF({ source_key: "  " }), "requires entity_type, source, source_key"],
    ] as const) {
      const out = JSON.parse(
        svc(`SELECT public.ensure_workflow_run_for_subject('${TEMPLATE}', 'twinref-${RUN}-bad',
               NULL, NULL, '{}'::jsonb, '${bindings}'::jsonb)`),
      );
      expect(out.ok).toBe(false);
      expect(out.error).toContain(hint);
    }
    expect(
      svc(`SELECT count(*) FROM public.production_batches WHERE batch_code = 'twinref-${RUN}-bad'`),
    ).toBe("0");
  });

  it.skipIf(!dbAvailable)("visibility opens only on a CONFIRMED account binding", () => {
    const twinId = svc(
      `SELECT s.input_data->>'authorized_twin_id'
         FROM public.production_workflow_steps s
         JOIN public.production_batches b ON b.id = s.batch_id
        WHERE b.batch_code = 'twinref-${RUN}-1' AND s.step_code = 'handover'`,
    );
    const uid = randomUUID(); // per-run: jeden účet smí mít jen jednu aktivní vazbu
    const visible = (state: string | null) => {
      if (state) {
        // insert-if-absent + přechod stavů UPDATEm: uq_twin_external_refs_active_owner
        // je částečný (hlídá jen aktivní vazbu), takže opakovaný INSERT by vyrobil
        // druhý řádek a potvrzení obou by unikát shodilo.
        // ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10) — dřív tu byl náhradní slug a CHECK ho odmítl.
        svc(`INSERT INTO public.twin_external_refs
               (twin_id, source, source_key, ref_kind, state, proposed_by)
             SELECT '${twinId}', 'aisha_auth', '${uid}', 'account', 'proposed', 'test'
             WHERE NOT EXISTS (SELECT 1 FROM public.twin_external_refs
               WHERE twin_id='${twinId}' AND ref_kind='account' AND source_key='${uid}')`);
        svc(`UPDATE public.twin_external_refs
                SET state='${state}',
                    confirmed_at = CASE WHEN '${state}'='confirmed' THEN now() END
              WHERE twin_id='${twinId}' AND ref_kind='account' AND source_key='${uid}'`);
      }
      return svc(
        `SELECT public.workflow_step_visible_to('${uid}'::uuid, NULL, NULL,
                jsonb_build_object('authorized_twin_id', '${twinId}'))::text`,
      );
    };
    expect(visible(null)).toBe("false"); // minted twin alone shows nothing
    expect(visible("proposed")).toBe("false"); // proposal is not ratification
    expect(visible("confirmed")).toBe("true"); // human-confirmed binding opens it
  });
});
