// ─────────────────────────────────────────────────────────────────────
// Detail dvojčete na ploše (ADR-003, K3): registr → řádek jako záznam → detail
// ─────────────────────────────────────────────────────────────────────
//
// Co se měří proti reálné DB (transakce + ROLLBACK):
//   1. Tabulka registru vydá `row_kind` a `rows[].id` z konfigurace, takže
//      shell má z čeho otevřít detail (detail_by_kind), a filtr [{src,param}]
//      zúží řádky podle klientského parametru — hodnota jde do dotazu jen
//      jako literál.
//   2. record_detail nad pohledem vydá pole, odznaky a citaci z konfigurace;
//      bez identity je to poctivý „žádný záznam", ne chyba.
//   3. timeline nad osou dvojčete vydá stopy (otevřený takt follow-upu je
//      typový záznam na ose subjektu — kloub K2 tu prosvítá).
//   4. CELÁ CESTA dispečerem: restricted blok s deklarací `client_params`
//      dostane `twin_id` a vrátí detail; bez deklarace nic. To je ten rozdíl,
//      který K3 přinesl.
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const OP = "c4000000-1111-4000-8000-0000000000d1";
const SUBJ = "c4000000-2222-4000-8000-0000000000d2";

function asUser(sub: string): string {
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
}

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', 'k3-op@test.local'), ('${SUBJ}', 'k3-subj@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name) VALUES
  ('${OP}', 'k3-op@test.local', 'Operator'), ('${SUBJ}', 'k3-subj@test.local', 'Subject Person')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active) VALUES
  ('get_audience_view_record_block', 't', true), ('get_audience_view_timeline_block', 't', true)
ON CONFLICT (rpc_name) DO UPDATE SET is_active = true;
-- bloky pro část 4 (vkládá fixtura: authenticated do surface_blocks nepíše)
INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active) VALUES
  ('k3_twin_detail', 'record_detail', 'k3.t', 'get_audience_view_record_block',
   jsonb_build_object('view','audience_admin_twin_directory_v','key_src','twin_id','id_param','twin_id',
                      'fields', jsonb_build_array(jsonb_build_object('key','label','label_key','app.cols.twin_label','src','label')),
                      'client_params', jsonb_build_object('twin_id','uuid')),
   'k3', 'restricted', true),
  ('k3_twin_detail_bare', 'record_detail', 'k3.t', 'get_audience_view_record_block',
   jsonb_build_object('view','audience_admin_twin_directory_v','key_src','twin_id','id_param','twin_id',
                      'fields', jsonb_build_array(jsonb_build_object('key','label','label_key','app.cols.twin_label','src','label'))),
   'k3', 'restricted', true);
INSERT INTO public.surface_layouts (surface, block_id, audience, position, is_active)
SELECT 'k3_probe', b.id, '{"roles":["admin","staff"]}'::jsonb, 0, true FROM public.surface_blocks b WHERE b.namespace = 'k3';
`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
SELECT 'twin=' || (public.twin_ensure_for_account('${SUBJ}', 'Subject Person') IS NOT NULL)::text AS out;
SELECT 'beat=' || (public.audience_admin_create_followup('${SUBJ}', now() + interval '2 days', 'zavolat', '${OP}') IS NOT NULL)::text AS out;

-- 1. registr: row_kind + id + filtr
SELECT 'row_kind=' || (b->'data'->>'row_kind') || '/' || ((b->'data'->'rows'->0->>'id') IS NOT NULL)::text AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'row_kind', 'twin', 'id_src', 'twin_id',
  'columns', jsonb_build_array(jsonb_build_object('key','label','label_key','app.cols.twin_label','src','label')),
  'filters', jsonb_build_array(jsonb_build_object('src','twin_id','param','twin_id')),
  'twin_id', public.twin_for_account('${SUBJ}')::text)) AS b;
SELECT 'filter_other=' || jsonb_array_length(b->'data'->'rows') AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'id_src', 'twin_id',
  'columns', jsonb_build_array(jsonb_build_object('key','label','label_key','k','src','label')),
  'filters', jsonb_build_array(jsonb_build_object('src','twin_id','param','twin_id')),
  'twin_id', '00000000-0000-4000-8000-00000000dead')) AS b;
SELECT 'queue_by_twin=' || jsonb_array_length(b->'data'->'rows') AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_followup_queue_v',
  'columns', jsonb_build_array(jsonb_build_object('key','note','label_key','k','src','note')),
  'filters', jsonb_build_array(jsonb_build_object('src','twin_id','param','twin_id')),
  'twin_id', public.twin_for_account('${SUBJ}')::text)) AS b;

-- 2. record_detail: pole, odznaky, citace; bez identity poctivé prázdno
SELECT 'record=' || (b->'data'->>'record_id' = public.twin_for_account('${SUBJ}')::text)::text
       || '/' || jsonb_array_length(b->'data'->'fields')
       || '/' || (b->'data'->'badges' ? 'app.badge.kind.person')::text
       || '/' || ((b->'data'->'fields'->2->>'value')::numeric >= 1)::text AS out
FROM public.get_audience_view_record_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'key_src', 'twin_id', 'id_param', 'twin_id',
  'fields', jsonb_build_array(
     jsonb_build_object('key','label','label_key','app.cols.twin_label','src','label'),
     jsonb_build_object('key','tier','label_key','app.cols.twin_tier','src','member_tier'),
     jsonb_build_object('key','open','label_key','app.cols.twin_open_beats','src','open_beats','numeric',true)),
  'badges', jsonb_build_array(jsonb_build_object('src','entity_type','key_prefix','app.badge.kind.')),
  'twin_id', public.twin_for_account('${SUBJ}')::text)) AS b;
SELECT 'record_none=' || (b->'data'->>'record_id' IS NULL)::text || '/' || (b->'provenance'->>'trace_id') AS out
FROM public.get_audience_view_record_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'key_src', 'twin_id', 'id_param', 'twin_id',
  'fields', jsonb_build_array(jsonb_build_object('key','label','label_key','k','src','label')))) AS b;

-- 3. timeline: otevřený takt je stopa na ose dvojčete
SELECT 'timeline=' || (jsonb_array_length(b->'data'->'items') >= 1)::text
       || '/' || ((b->'data'->'items'->0->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')::text AS out
FROM public.get_audience_view_timeline_block(jsonb_build_object(
  'view', 'audience_admin_twin_timeline_v', 'at_src', 'occurred_at', 'label_src', 'content',
  'filters', jsonb_build_array(jsonb_build_object('src','twin_id','param','twin_id')),
  'twin_id', public.twin_for_account('${SUBJ}')::text)) AS b;

-- 4. celá cesta dispečerem: restricted blok + deklarace → detail; bez deklarace → nic
SELECT 'dispatch=' || (public.get_block_data('k3_twin_detail', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')))->'data'->>'record_id'
                      = public.twin_for_account('${SUBJ}')::text)::text AS out;
SELECT 'dispatch_bare=' || (public.get_block_data('k3_twin_detail_bare', jsonb_build_object('twin_id', public.twin_for_account('${SUBJ}')))->'data'->>'record_id' IS NULL)::text AS out;
RESET ROLE;
ROLLBACK;
`);
}

describe("detail dvojčete na ploše (K3): registr → záznam → detail", () => {
  beforeAll(async () => {
    await reportTestCapabilities("audience detail blocks");
  });

  it.skipIf(!dbAvailable)("registr vydá row_kind + id a filtruje podle parametru jako literálu", () => {
    const out = probe();
    expect(out).toContain("row_kind=twin/true");
    expect(out).toContain("filter_other=0");
    expect(out).toContain("queue_by_twin=1");
  });

  it.skipIf(!dbAvailable)("record_detail vydá pole, odznaky a bez identity poctivé prázdno", () => {
    const out = probe();
    expect(out).toContain("record=true/3/true/true");
    expect(out).toContain("record_none=true/audience-record:no_record");
  });

  it.skipIf(!dbAvailable)("timeline vydá stopy z osy dvojčete (otevřený takt je stopa)", () => {
    const out = probe();
    expect(out).toContain("timeline=true/true");
  });

  it.skipIf(!dbAvailable)("dispečer: deklarace client_params je jediná cesta parametru do restricted bloku", () => {
    const out = probe();
    expect(out).toContain("dispatch=true");
    expect(out).toContain("dispatch_bare=true");
  });
});
