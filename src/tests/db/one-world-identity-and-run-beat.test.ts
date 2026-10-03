// ─────────────────────────────────────────────────────────────────────
// Jeden svět (ADR-003) — K1 identita a K2 kloub krok ↔ takt
// ─────────────────────────────────────────────────────────────────────
//
// Čtyři tvrzení, každé měřené proti reálné databázi v transakci s ROLLBACK:
//
//   1. IDENTITA (K1). Účet je POTVRZENÁ REFERENCE na dvojčeti, ne identita sama.
//      twin_ensure_for_account je mint-or-match (dvakrát volané vrátí totéž
//      dvojče), twin_for_account referenci přečte, backfill dorodí profil, který
//      dvojče nemá. Registr pak nese ObOJE: dvojče s účtem i dvojče bez účtu
//      (kolega, firma) — to je celý důvod, proč K1 existuje.
//
//   2. PRÁCE JE BĚH (K2, D4). audience_admin_create_followup otevře BĚH ze
//      šablony `follow-up` a vrátí id TAKTU. Žádný ai_tasks řádek — dvě pravdy
//      o téže práci byly to, co K2 ruší.
//
//   3. KLOUB. Potvrzení kroku uzavře takt kroku, zapíše potvrzení na osu
//      SUBJEKTU (ne operátora) a otevře takt DALŠÍHO lidského uzlu. Bez tohohle
//      by běh v „moje kroky" nikdy nedlužil nic a fronta by zůstala prázdná.
//
//   4. AUTORIZACE. Ne-operátor follow-up nezaloží. Guard je v RPC, ne v UI.
//
// Offline (bez dosažitelného PG) se sada čistě přeskočí, jako její sourozenci.
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

const OP = "c0000000-1111-4000-8000-00000000000c"; // operátor (admin/staff)
const SUBJ = "c0000000-2222-4000-8000-00000000000d"; // aktér, se kterým se pracuje
const NOACC = "c0000000-3333-4000-8000-00000000000e"; // profil bez dvojčete (před backfillem)
const OUT = "c0000000-4444-4000-8000-00000000000f"; // ne-operátor

function asUser(sub: string): string {
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
}

/**
 * Takty KROKŮ vlastní dávky (`b` = story_pulse_beats). ⭐ Sondy čtou takt přes
 * krok SVÉHO běhu, ne jako „první/poslední otevřený v DB": ROLLBACK izoluje
 * zápisy, ne čtení — v souběhu (jedna sdílená throwaway DB) vidí každý příkaz,
 * co jiné soubory mezitím commitly. Naměřeno 2026-09-27: `due_from_node`
 * přečetl cizí takt a spadl na false. Kotva přes krok (ne přes subjekt) nechá
 * tvrzení o subjektu taktu skutečným tvrzením.
 */
function beatsOfBatch(batchCondition: string): string {
  return `b.source_type = 'workflow_step' AND b.source_id IN (
    SELECT s.id FROM public.production_workflow_steps s JOIN public.production_batches pb ON pb.id = s.batch_id
     WHERE ${batchCondition})`;
}

const FOLLOWUP_BEATS = beatsOfBatch(`pb.batch_code LIKE 'follow-up:${SUBJ}%'`);
const CHAIN_BEATS = beatsOfBatch(`pb.batch_code = 'ow-run-1'`);

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${OP}', 'ow-op@test.local'), ('${SUBJ}', 'ow-subject@test.local'),
  ('${NOACC}', 'ow-noacc@test.local'), ('${OUT}', 'ow-outsider@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name) VALUES
  ('${OP}', 'ow-op@test.local', 'Operator'), ('${SUBJ}', 'ow-subject@test.local', 'Subject Person'),
  ('${NOACC}', 'ow-noacc@test.local', 'No Account Twin'), ('${OUT}', 'ow-outsider@test.local', 'Outsider')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
`;

/** K1 — identita: dvojče je entita, účet je jeho potvrzená reference. */
function identityProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
-- 1. mint: účet dostane dvojče + potvrzenou referenci
SELECT 'twin_minted=' || (public.twin_ensure_for_account('${SUBJ}', 'Subject Person') IS NOT NULL)::text AS out;
-- 2. match: druhé volání vrací TOTÉŽ dvojče (idempotence, ne druhá identita)
SELECT 'twin_stable=' || (public.twin_ensure_for_account('${SUBJ}') = public.twin_for_account('${SUBJ}'))::text AS out;
-- 3. reference je potvrzená a jediná aktivní
SELECT 'account_ref=' || count(*) || '/' || max(state) AS out
FROM public.twin_external_refs r
WHERE r.ref_kind = 'account' AND r.source_key = '${SUBJ}' AND r.valid_to IS NULL;
-- 4. kolega BEZ účtu je také entita registru
SELECT 'colleague=' || (public.twin_upsert_entity_audited('person','hr','emp-7781','Kolega bez účtu') ->> 'twin_id' IS NOT NULL)::text AS out;
-- 5. backfill dorodí profil, který dvojče nemá
SELECT 'backfilled>=1=' || (public.twin_backfill_accounts_admin(100) >= 1)::text AS out;
SELECT 'noacc_bound=' || (public.twin_for_account('${NOACC}') IS NOT NULL)::text AS out;
-- 6. registr nese oboje: entitu s účtem i bez něj, a nikdo nezmizel
SELECT 'reg_with_account=' || count(*) AS out FROM public.audience_admin_twin_directory_v
 WHERE user_id = '${SUBJ}' AND twin_id IS NOT NULL;
SELECT 'reg_colleague=' || count(*) AS out FROM public.audience_admin_twin_directory_v
 WHERE label = 'Kolega bez účtu' AND user_id IS NULL;
-- ⭐ nad profily FIXTURE: jiné soubory commitují své profily bez dvojčete
-- a v souběhu by je globální počet (po backfillu v téhle transakci) přičetl
SELECT 'reg_unbound_gone=' || count(*) AS out FROM public.audience_admin_twin_directory_v
 WHERE twin_status = 'unbound' AND user_id IN ('${OP}', '${SUBJ}', '${NOACC}', '${OUT}');
RESET ROLE;
ROLLBACK;
`);
}

/** K2 — práce je běh: follow-up otevře běh + takt, potvrzení kroku takt uzavře. */
function runBeatProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
SELECT 'twin=' || (public.twin_ensure_for_account('${SUBJ}', 'Subject Person') IS NOT NULL)::text AS out;
-- follow-up = BĚH, návratem je TAKT
SELECT 'beat=' || (public.audience_admin_create_followup(
  '${SUBJ}', now() + interval '2 days', 'zavolat zpět', '${OP}') IS NOT NULL)::text AS out;
-- žádný ai_tasks řádek: jedna pravda o práci
SELECT 'no_ai_task=' || (count(*) = 0)::text AS out FROM public.ai_tasks WHERE task_type = 'follow_up';
-- běh existuje a má lidský uzel
SELECT 'run_steps=' || count(*) AS out FROM public.production_workflow_steps s
  JOIN public.production_batches b ON b.id = s.batch_id
 WHERE b.batch_code LIKE 'follow-up:${SUBJ}%';
-- takt visí NA KROKU a na subjektu (dvojčeti aktéra)
SELECT 'beat_source=' || b.source_type || '/' || b.subject_type || '/' ||
       (b.subject_id = public.twin_for_account('${SUBJ}'))::text AS out
FROM public.story_pulse_beats b WHERE b.status = 'open' AND ${FOLLOWUP_BEATS} ORDER BY b.created_at DESC LIMIT 1;
-- fronta ho vidí a umí ho zařadit do koše
SELECT 'queue=' || q.bucket || '/' || (q.actor_user_id = '${SUBJ}')::text || '/' || q.beat_type AS out
FROM public.audience_admin_followup_queue_v q
WHERE q.task_id IN (SELECT b.id FROM public.story_pulse_beats b WHERE ${FOLLOWUP_BEATS})
ORDER BY q.created_at DESC LIMIT 1;
-- potvrzení: uzavře se KROKEM (jediná zápisová cesta práce)
SELECT 'completed=' || public.audience_admin_complete_followup(
  (SELECT b.id FROM public.story_pulse_beats b WHERE b.status = 'open' AND ${FOLLOWUP_BEATS}
    ORDER BY b.created_at DESC LIMIT 1),
  'domluveno')::text AS out;
SELECT 'beat_settled=' || b.status || '/' || (b.closing_entry_id IS NOT NULL)::text AS out
FROM public.story_pulse_beats b WHERE ${FOLLOWUP_BEATS} ORDER BY b.created_at DESC LIMIT 1;
-- potvrzení je záznam na ose SUBJEKTU, autorem je operátor (čte se přes takt,
-- který na něj ukazuje — closing_entry_id — ne jako poslední záznam v DB)
SELECT 'confirmation=' || se.subject_type || '/' ||
       (se.subject_id = public.twin_for_account('${SUBJ}'))::text || '/' ||
       (se.created_by = '${OP}')::text AS out
FROM public.story_entries se WHERE se.entry_type = 'pulse_beat_closed'
  AND se.id IN (SELECT b.closing_entry_id FROM public.story_pulse_beats b WHERE ${FOLLOWUP_BEATS})
ORDER BY se.created_at DESC LIMIT 1;
-- fronta je prázdná, práce je hotová
-- ⭐ NAD SVÝM SUBJEKTEM: globální počet platí jen v prázdné databázi a v souběhu
-- (jedna sdílená throwaway DB) měří cizí práci.
SELECT 'queue_empty=' || (count(*) = 0)::text AS out FROM public.audience_admin_followup_queue_v
 WHERE actor_user_id = '${SUBJ}';
-- krok běhu je dokončený (ne jen takt)
SELECT 'step_done=' || count(*) AS out FROM public.production_workflow_steps s
  JOIN public.production_batches b ON b.id = s.batch_id
 WHERE b.batch_code LIKE 'follow-up:${SUBJ}%' AND s.status = 'completed';
RESET ROLE;
ROLLBACK;
`);
}

/** Kloub na víceuzlovém běhu: dokončení uzlu 1 otevře takt uzlu 2. */
function chainProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
INSERT INTO public.production_workflow_templates (name, description, product_type, workflow_steps, is_active)
VALUES ('ow-test-journey', 'two human nodes', 'generic',
  '[{"step_code":"first","step_name":"První","step_order":1,"assigned_role":"admin","beat_type":"first"},
    {"step_code":"second","step_name":"Druhý","step_order":2,"assigned_role":"admin","beat_type":"second"}]'::jsonb,
  true);
SELECT 'run=' || (public.ensure_workflow_run_for_subject('ow-test-journey','ow-run-1','Cesta', current_date,
        jsonb_build_object('subject_actor_id','${SUBJ}','due_in','3 days'),
        jsonb_build_object('first', jsonb_build_object('assigned_user_id','${OP}'),
                           'second', jsonb_build_object('assigned_user_id','${OP}'))) ->> 'ok') AS out;
-- hned po otevření dluží PRVNÍ uzel, druhý ne (nedluží se dopředu)
SELECT 'open_after_start=' || count(*) || '/' || max(b.beat_type) AS out
FROM public.story_pulse_beats b
WHERE b.status = 'open' AND b.source_type = 'workflow_step'
  AND (b.subject_id = '${SUBJ}' OR b.subject_id = public.twin_for_account('${SUBJ}'));
-- termín z uzlu (due_in) se promítl
SELECT 'due_from_node=' || (b.due_at::date = (now() + interval '3 days')::date)::text AS out
FROM public.story_pulse_beats b WHERE b.status = 'open' AND ${CHAIN_BEATS} ORDER BY b.created_at LIMIT 1;
-- potvrzení prvního uzlu → jeho takt zavřen, druhý otevřen
SELECT 'step1=' || (public.complete_workflow_step(
  (SELECT s.id FROM public.production_workflow_steps s JOIN public.production_batches b ON b.id = s.batch_id
    WHERE b.batch_code = 'ow-run-1' AND s.step_code = 'first'), '{}'::jsonb, 'hotovo') ->> 'ok') AS out;
SELECT 'chained=' || b.beat_type || '/' || b.status AS out
FROM public.story_pulse_beats b WHERE b.status = 'open' AND ${CHAIN_BEATS} ORDER BY b.created_at DESC LIMIT 1;
SELECT 'first_closed=' || b.status AS out
FROM public.story_pulse_beats b WHERE b.beat_type = 'first' AND ${CHAIN_BEATS} ORDER BY b.created_at LIMIT 1;
RESET ROLE;
ROLLBACK;
`);
}

/** Autorizace: ne-operátor follow-up nezaloží (guard je v RPC). */
function denyProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
CREATE TEMP TABLE ow_probe(k text, v text) ON COMMIT DROP;
GRANT INSERT ON ow_probe TO authenticated;
${asUser(OUT)}
DO $$
BEGIN
  PERFORM public.audience_admin_create_followup('${SUBJ}', now() + interval '1 day', 'x', NULL);
  INSERT INTO ow_probe VALUES ('outsider_followup', 'ALLOWED');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO ow_probe VALUES ('outsider_followup', 'DENIED');
END $$;
DO $$
BEGIN
  PERFORM public.twin_ensure_for_account('${SUBJ}', 'hijack');
  INSERT INTO ow_probe VALUES ('foreign_account', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO ow_probe VALUES ('foreign_account', 'DENIED');
END $$;
DO $$
DECLARE v uuid;
BEGIN
  v := public.twin_ensure_for_account('${OUT}', 'vlastní');
  INSERT INTO ow_probe VALUES ('own_account', case when v is null then 'NULL' else 'ALLOWED' end);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO ow_probe VALUES ('own_account', 'DENIED');
END $$;
RESET ROLE;
SELECT k || '=' || v AS out FROM ow_probe ORDER BY k;
ROLLBACK;
`);
}

describe("jeden svět — identita (K1) a kloub krok ↔ takt (K2)", () => {
  beforeAll(async () => {
    await reportTestCapabilities("one world identity + run beat");
  });

  it.skipIf(!dbAvailable)("účet je potvrzená reference na dvojčeti, registr nese i entity bez účtu", () => {
    const out = identityProbe();
    expect(out).toContain("twin_minted=true");
    expect(out).toContain("twin_stable=true");
    expect(out).toContain("account_ref=1/confirmed");
    expect(out).toContain("colleague=true");
    expect(out).toContain("backfilled>=1=true");
    expect(out).toContain("noacc_bound=true");
    expect(out).toContain("reg_with_account=1");
    expect(out).toContain("reg_colleague=1");
    expect(out).toContain("reg_unbound_gone=0");
  });

  it.skipIf(!dbAvailable)("follow-up je běh; takt visí na kroku a na dvojčeti subjektu", () => {
    const out = runBeatProbe();
    expect(out).toContain("beat=true");
    expect(out).toContain("no_ai_task=true");
    expect(out).toContain("run_steps=1");
    expect(out).toContain("beat_source=workflow_step/twin/true");
    expect(out).toContain("queue=this_week/true/follow_up");
  });

  it.skipIf(!dbAvailable)("potvrzení kroku uzavře takt a zapíše potvrzení na osu subjektu", () => {
    const out = runBeatProbe();
    expect(out).toContain("completed=true");
    expect(out).toContain("beat_settled=done/true");
    expect(out).toContain("confirmation=twin/true/true");
    expect(out).toContain("queue_empty=true");
    expect(out).toContain("step_done=1");
  });

  it.skipIf(!dbAvailable)("kloub řetězí běh: dokončený uzel zavírá svůj takt a otevírá další", () => {
    const out = chainProbe();
    expect(out).toContain("run=true");
    expect(out).toContain("open_after_start=1/first");
    expect(out).toContain("due_from_node=true");
    expect(out).toContain("step1=true");
    expect(out).toContain("chained=second/open");
    expect(out).toContain("first_closed=done");
  });

  it.skipIf(!dbAvailable)("autorizace váže subjekt: cizí účet ani cizí follow-up neprojde", () => {
    const out = denyProbe();
    expect(out).toContain("outsider_followup=DENIED");
    expect(out).toContain("foreign_account=DENIED");
    expect(out).toContain("own_account=ALLOWED");
  });
});
