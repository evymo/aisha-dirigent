// ─────────────────────────────────────────────────────────────────────
// Akce správy z plochy (ADR-003, K4) — allowlist + jedno auditované RPC
// ─────────────────────────────────────────────────────────────────────
//
// Co se měří proti reálné DB (transakce + ROLLBACK):
//
//   1. ALLOWLIST. Akce je řádek `surface_actions`; neexistující nebo neaktivní
//      slug = 42501 (nic se neprozrazuje). Řádek vidí jen ten, komu ho publikum
//      přizná (RLS) — outsider ho nevidí ani v bloku, ani při submitu.
//   2. DEKLARACE POLÍ. Chybějící povinné pole a hodnota mimo výčet = 22023;
//      neznámý klíč payloadu se zahodí, nikdy nedoteče k RPC.
//   3. CELÁ CESTA. `followup.create` přes submit založí BĚH (K2): takt na
//      dvojčeti, fronta ho vidí; `tag.add` zapíše značku; `touch.log` zapíše
//      záznam na osu dvojčete a s termínem i follow-up. Každé volání má audit
//      s slugem, bez PII (jen klíče payloadu).
//   4. BLOK. get_surface_actions_block vydá volajícímu jen jeho akce, s
//      deklarací polí a identitou cíle z parametru.
//
// Cílová RPC drží vlastní autorizaci: dispečer běží jako volající (INVOKER),
// takže outsider s viditelnou akcí by stejně narazil na is_admin_or_staff.
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

const OP = "c7000000-1111-4000-8000-0000000000a1";
const SUBJ = "c7000000-2222-4000-8000-0000000000a2";
const OUT = "c7000000-3333-4000-8000-0000000000a3";

function asUser(sub: string): string {
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
}

// Fixtura: účty, profily, role, dvojče subjektu a tři akce v allowlistu
// (vkládá superuser — authenticated do surface_actions nepíše).
const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${OP}', 'sa-op@test.local'), ('${SUBJ}', 'sa-subj@test.local'), ('${OUT}', 'sa-out@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name) VALUES
  ('${OP}', 'sa-op@test.local', 'Operator'), ('${SUBJ}', 'sa-subj@test.local', 'Subject'), ('${OUT}', 'sa-out@test.local', 'Outsider')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.surface_actions (action_slug, title_key, target_kind, rpc_name, arg_map, fields, returns_void, audience, namespace, is_active) VALUES
  ('sa_test.followup', 'k.followup', 'twin', 'audience_admin_create_followup',
   '[{"name":"p_actor_id","from":"target.user_id","type":"uuid"},
     {"name":"p_due_at","from":"payload","key":"due_at","type":"timestamptz"},
     {"name":"p_note","from":"payload","key":"note","type":"text"},
     {"name":"p_assigned_to","from":"payload","key":"assigned_to","type":"uuid","fallback":"caller.user_id"}]'::jsonb,
   '[{"key":"due_at","label_key":"k.due","type":"timestamptz","required":true},
     {"key":"note","label_key":"k.note","type":"textarea","required":true},
     {"key":"assigned_to","label_key":"k.assignee","type":"uuid"}]'::jsonb,
   false, '{"roles":["admin","staff"]}'::jsonb, 'sa_test', true),
  ('sa_test.tag', 'k.tag', 'twin', 'audience_tag_resource',
   '[{"name":"p_label","from":"payload","key":"label","type":"text"},
     {"name":"p_resource_type","from":"const","value":"actor","type":"text"},
     {"name":"p_resource_id","from":"target.user_id","type":"uuid"},
     {"name":"p_color","from":"const","value":"gray","type":"text"}]'::jsonb,
   '[{"key":"label","label_key":"k.label","type":"enum","required":true,
      "options":[{"value":"retreat","label_key":"k.retreat"},{"value":"volunteer","label_key":"k.volunteer"}]}]'::jsonb,
   false, '{"roles":["admin","staff"]}'::jsonb, 'sa_test', true),
  ('sa_test.touch', 'k.touch', 'twin', 'audience_admin_log_touch',
   '[{"name":"p_subject_type","from":"const","value":"twin","type":"text"},
     {"name":"p_subject_id","from":"target.twin_id","type":"uuid"},
     {"name":"p_entry_type","from":"payload","key":"entry_type","type":"text"},
     {"name":"p_content","from":"payload","key":"content","type":"text"},
     {"name":"p_occurred_at","from":"payload","key":"occurred_at","type":"timestamptz","required":false},
     {"name":"p_follow_up_at","from":"payload","key":"follow_up_at","type":"timestamptz","required":false}]'::jsonb,
   '[{"key":"entry_type","label_key":"k.kind","type":"enum","required":true,
      "options":[{"value":"call","label_key":"k.call"},{"value":"meeting","label_key":"k.meeting"}]},
     {"key":"content","label_key":"k.content","type":"textarea","required":true},
     {"key":"occurred_at","label_key":"k.when","type":"timestamptz"},
     {"key":"follow_up_at","label_key":"k.followup","type":"timestamptz"}]'::jsonb,
   false, '{"roles":["admin","staff"]}'::jsonb, 'sa_test', true),
  ('sa_test.inactive', 'k.x', 'twin', 'audience_tag_resource', '[]'::jsonb, '[]'::jsonb, false, '{}'::jsonb, 'sa_test', false);
`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
SELECT 'twin=' || (public.twin_ensure_for_account('${SUBJ}', 'Subject') IS NOT NULL)::text AS out;
-- 4. blok: akce volajícího s identitou cíle
SELECT 'block=' || (b->'data'->>'target_kind') || '/' || (b->'data'->>'target_id' = public.twin_for_account('${SUBJ}')::text)::text || '/' ||
       (SELECT string_agg(a->>'slug', ',' ORDER BY a->>'slug') FROM jsonb_array_elements(b->'data'->'actions') a) AS out
FROM public.get_surface_actions_block(jsonb_build_object('target_kind','twin','namespace','sa_test','twin_id', public.twin_for_account('${SUBJ}'))) b;
-- 3a. follow-up přes submit = běh + takt na dvojčeti
SELECT 'followup=' || (r->>'ok') || '/' || ((r->'result') IS NOT NULL)::text AS out
FROM public.submit_surface_action('sa_test.followup', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')),
       jsonb_build_object('due_at', (now() + interval '2 days')::text, 'note', 'zavolat', 'junk', 'x')) r;
SELECT 'beat=' || b.status || '/' || b.source_type || '/' || b.subject_type || '/' || (b.assigned_to_user_id = '${OP}')::text AS out
FROM public.story_pulse_beats b
WHERE b.status = 'open' AND b.subject_id = public.twin_for_account('${SUBJ}')
ORDER BY b.created_at DESC LIMIT 1;
-- ⭐ POČÍTÁ SE NAD SVÝM SUBJEKTEM, ne nad celou tabulkou. Globální počet je
-- měřidlo, které platí jen v prázdné databázi: v souběhu 79 souborů (jedna
-- sdílená throwaway DB) do fronty vidí i cizí takty a test padá na cizí práci.
-- Fronta se měří jako VLASTNÍK (RESET ROLE): pohled s právy vlastníka klient
-- přímo nečte (od 2026-10-04 bez grantu pro authenticated — čte se přes DEFINER
-- bloky). Měří se stav databáze po submitu, ne cesta, kterou ho klient uvidí.
RESET ROLE;
SELECT 'queue=' || count(*) AS out FROM public.audience_admin_followup_queue_v
 WHERE actor_user_id = '${SUBJ}';
${asUser(OP)}
-- 3b. značka
SELECT 'tag=' || (r->>'ok') AS out
FROM public.submit_surface_action('sa_test.tag', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')), '{"label":"retreat"}'::jsonb) r;
SELECT 'label=' || count(*) AS out FROM public.story_labels WHERE resource_type = 'actor' AND resource_id = '${SUBJ}' AND label = 'retreat';
-- 3c. dotek s follow-upem
SELECT 'touch=' || (r->>'ok') || '/' || ((r->>'result') ~ '^"?[0-9a-f-]{36}"?$')::text AS out
FROM public.submit_surface_action('sa_test.touch', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')),
       jsonb_build_object('entry_type','call','content','hovor o retreatu','follow_up_at',(now() + interval '5 days')::text)) r;
SELECT 'touch_entry=' || count(*) AS out FROM public.story_entries se WHERE se.subject_type = 'twin' AND se.subject_id = public.twin_for_account('${SUBJ}') AND se.entry_type = 'call';
SELECT 'open_beats=' || count(*) AS out FROM public.story_pulse_beats
 WHERE status = 'open' AND subject_id = public.twin_for_account('${SUBJ}');
-- audit: slug, bez PII (klíče payloadu, ne hodnoty)
SELECT 'audit=' || count(*) || '/' || bool_and(NOT (details::text LIKE '%hovor o retreatu%'))::text AS out
FROM public.audit_journal WHERE action_type = 'surface_action' AND action IN ('sa_test.followup','sa_test.tag','sa_test.touch');
RESET ROLE;
ROLLBACK;
`);
}

function denyProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
CREATE TEMP TABLE sa_probe(k text, v text) ON COMMIT DROP;
GRANT INSERT ON sa_probe TO authenticated;
${asUser(OP)}
SELECT public.twin_ensure_for_account('${SUBJ}', 'Subject');
DO $$ BEGIN
  PERFORM public.submit_surface_action('sa_test.nope', '{}'::jsonb, '{}'::jsonb);
  INSERT INTO sa_probe VALUES ('unknown_slug', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sa_probe VALUES ('unknown_slug', 'DENIED'); END $$;
DO $$ BEGIN
  PERFORM public.submit_surface_action('sa_test.inactive', '{}'::jsonb, '{}'::jsonb);
  INSERT INTO sa_probe VALUES ('inactive', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sa_probe VALUES ('inactive', 'DENIED'); END $$;
DO $$ BEGIN
  PERFORM public.submit_surface_action('sa_test.followup', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')), '{"note":"bez termínu"}'::jsonb);
  INSERT INTO sa_probe VALUES ('missing_required', 'ALLOWED');
EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO sa_probe VALUES ('missing_required', 'REJECTED'); END $$;
DO $$ BEGIN
  PERFORM public.submit_surface_action('sa_test.tag', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')), '{"label":"not-in-options"}'::jsonb);
  INSERT INTO sa_probe VALUES ('enum_outside', 'ALLOWED');
EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO sa_probe VALUES ('enum_outside', 'REJECTED'); END $$;
RESET ROLE;
${asUser(OUT)}
-- outsider: akci ani nevidí (RLS publikum), submit = 42501
SELECT 'outsider_sees=' || jsonb_array_length(public.get_surface_actions_block('{"target_kind":"twin","namespace":"sa_test"}'::jsonb)->'data'->'actions') AS out;
DO $$ BEGIN
  PERFORM public.submit_surface_action('sa_test.tag', '{"twin_id":"00000000-0000-4000-8000-000000000001"}'::jsonb, '{"label":"retreat"}'::jsonb);
  INSERT INTO sa_probe VALUES ('outsider_submit', 'ALLOWED');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sa_probe VALUES ('outsider_submit', 'DENIED'); END $$;
RESET ROLE;
SELECT k || '=' || v AS out FROM sa_probe ORDER BY k;
ROLLBACK;
`);
}

describe("akce správy z plochy (K4): allowlist + submit_surface_action", () => {
  beforeAll(async () => {
    await reportTestCapabilities("surface actions contract");
  });

  it.skipIf(!dbAvailable)("blok vydá akce volajícího s cílem; submit projde celou cestou (běh, značka, dotek) s auditem bez PII", () => {
    const out = probe();
    expect(out).toContain("twin=true");
    expect(out).toContain("block=twin/true/sa_test.followup,sa_test.tag,sa_test.touch");
    expect(out).toContain("followup=true/true");
    expect(out).toContain("beat=open/workflow_step/twin/true");
    expect(out).toContain("queue=1");
    expect(out).toContain("tag=true");
    expect(out).toContain("label=1");
    expect(out).toContain("touch=true/true");
    expect(out).toContain("touch_entry=1");
    expect(out).toContain("open_beats=2");
    expect(out).toContain("audit=3/true");
  });

  it.skipIf(!dbAvailable)("allowlist a deklarace polí: neznámé/neaktivní = 42501, chybějící a mimo výčet = 22023, outsider nic nevidí", () => {
    const out = denyProbe();
    expect(out).toContain("unknown_slug=DENIED");
    expect(out).toContain("inactive=DENIED");
    expect(out).toContain("missing_required=REJECTED");
    expect(out).toContain("enum_outside=REJECTED");
    expect(out).toContain("outsider_sees=0");
    expect(out).toContain("outsider_submit=DENIED");
  });
});
