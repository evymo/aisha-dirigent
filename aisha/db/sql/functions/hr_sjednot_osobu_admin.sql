-- ============================================================================
-- Source of Truth: hr_sjednot_osobu_admin
-- Popis: HR sjednotí ÚLOMKY téhož člověka pod jednu (kanonickou) osobu.
--        Jedno ROZHODNUTÍ ČLOVĚKA, vratné (revert_twin_decision_admin).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; jen admin/staff S REÁLNOU
--             identitou (i náhled: odpovídá o osobních údajích)
--
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-23): „kokpit ingestu navrhuje vazby, propojuje
--    atp., ale HR spojuje nález s člověkem / přístupem, resp. identitou."
--    HR je JEDINÁ autorita identity člověka; ingest navrhuje a z rozhodnutí se učí.
--
-- ⛔ PROČ (naměřeno 2026-09-23 v produkci riq, jen čtením): 1 487 twinů `driver`
--    na zhruba 47 řidičů. Jeden člověk je rozpadlý podle zápisu jména ve zdroji
--    („KOŽUŠNÍK" / „Kožušník" / „p. Kožušník", 426 i se SPZ ve jméně). Účet se
--    váže na JEDNU osobu (uq_twin_external_refs_active_account), takže bez
--    sjednocení by řidič viděl jen podíl úlomku, ke kterému dostal účet.
--
-- ⭐ CO SE DĚJE (každá položka se zapíše se stavem PŘED zásahem → vratné):
--   · vazby úlomků (identita ve zdrojích, návrhy) přejdou ke kanonické osobě.
--     ⭐ TÍM SE INGEST UČÍ: twin_upsert_entity_audited hledá twin přes potvrzenou
--       primární vazbu (zdroj, klíč) — další doklad s „KOŽUŠNÍK" dopadne rovnou
--       ke kanonické osobě, bez zásahu do ingestu.
--     Návrh, který kanonická osoba už má (týž zdroj, klíč, druh), se u úlomku
--     jen UKONČÍ — přesun by ho zdvojil (návrhy nemají unikátní index).
--   · ČEKAJÍCÍ úkoly (authorized_twin_id) se přepojí. Hotová práce drží, komu
--     patřila — historie se nepřepisuje.
--   · úlomky se ARCHIVUJÍ (nic se nemaže), nesou `archivovano_rozhodnutim`
--     a `sjednoceno_do`.
--   · jméno kanonické osoby se ZAMKNE (`label_hr`): ingest by ho jinak při
--     každém doručení přepsal zápisem, který přišel naposled.
--
-- ⛔ ODMÍTNE (nic nezapíše):
--   · úlomek s VLASTNÍM účtem — člověk by měl dva účty (index to zakazuje);
--     nejdřív ho odvázat (hr_odvaz_ucet_admin),
--   · jiný druh osoby (driver × person …) — to není úlomek, ale jiná entita,
--   · neaktivní / neexistující / kanonickou osobu mezi úlomky.
--
-- ⛔ VAZBY K DALŠÍM ENTITÁM (twin_relations) se NEPŘESOUVAJÍ, jen spočítají.
--    Naměřeno 2026-09-23: twin_relations = 0 (síť vazeb z dokladů je další
--    krok). Až vznikne, musí sjednocení přesouvat i je.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true): počty, nic nezapíše.
-- Kontrakt: (uuid, uuid[], text, boolean) ->
--   jsonb {ok, dry_run, decision_id?, pocty:{vazeb_presunout, vazeb_ukoncit,
--          kroku_prepojit, kroku_hotovych_zustava, zaznamu_archivovat,
--          relaci_zustava}} | {ok:false, error, ...}
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hr_sjednot_osobu_admin(
  p_kanon uuid,
  p_ulomky uuid[],
  p_duvod text DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hr uuid := auth.uid();
  v_kanon record;
  v_ulomky uuid[];
  v_spatne int;
  v_s_uctem int;
  v_decision uuid;
  v_presunute jsonb;
  v_nahrazene jsonb;
  v_kroky jsonb;
  v_twiny jsonb;
  v_hotove int;
  v_relace int;
  v_pocty jsonb;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;
  IF v_hr IS NULL THEN
    RAISE EXCEPTION 'Decision requires an authenticated person (auth.uid() is null)';
  END IF;

  SELECT id, entity_type, label, status, metadata INTO v_kanon
    FROM public.twin_entities WHERE id = p_kanon;
  IF v_kanon.id IS NULL OR v_kanon.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'kanon_neni_aktivni');
  END IF;

  SELECT array_agg(DISTINCT u) INTO v_ulomky
    FROM unnest(COALESCE(p_ulomky, '{}'::uuid[])) AS u
   WHERE u IS NOT NULL;
  IF v_ulomky IS NULL OR cardinality(v_ulomky) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'zadne_ulomky');
  END IF;
  IF p_kanon = ANY (v_ulomky) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'kanon_mezi_ulomky');
  END IF;
  IF cardinality(v_ulomky) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prilis_mnoho_ulomku');
  END IF;

  -- Každý úlomek: existuje, aktivní, TÝŽ druh jako kanon.
  SELECT count(*) INTO v_spatne
    FROM unnest(v_ulomky) AS u
    LEFT JOIN public.twin_entities t ON t.id = u
   WHERE t.id IS NULL OR t.status <> 'active' OR t.entity_type <> v_kanon.entity_type;
  IF v_spatne > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ulomek_neni_stejneho_druhu_nebo_aktivni',
                              'pocet', v_spatne, 'druh', v_kanon.entity_type);
  END IF;

  -- Úlomek s vlastním účtem → člověk by měl dva účty.
  SELECT count(*) INTO v_s_uctem
    FROM public.twin_external_refs r
   WHERE r.twin_id = ANY (v_ulomky)
     AND r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL;
  IF v_s_uctem > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ulomek_ma_ucet', 'pocet', v_s_uctem);
  END IF;

  -- Vazby úlomků: přesunout, nebo (duplicitní návrh) ukončit.
  -- Dvě úlomky se stejným návrhem (zdroj, klíč, druh, stav) by po přesunu daly
  -- kanonu týž návrh dvakrát → přesune se jen PRVNÍ z každé skupiny, ostatní se
  -- ukončí. (Potvrzené vazby jsou unikátní globálně, tam skupina má vždy 1 řádek.)
  WITH vazby AS (
    SELECT r.id, r.twin_id, r.state,
           EXISTS (SELECT 1 FROM public.twin_external_refs k
                    WHERE k.twin_id = p_kanon AND k.source = r.source
                      AND k.source_key = r.source_key AND k.ref_kind = r.ref_kind
                      AND k.state = r.state AND k.valid_to IS NULL)
           OR row_number() OVER (PARTITION BY r.source, r.source_key, r.ref_kind, r.state
                                 ORDER BY r.created_at, r.id) > 1 AS kanon_ma
      FROM public.twin_external_refs r
     WHERE r.twin_id = ANY (v_ulomky) AND r.valid_to IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'pred_twin_id', twin_id)) FILTER (WHERE NOT kanon_ma), '[]'::jsonb),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'pred_state', state)) FILTER (WHERE kanon_ma), '[]'::jsonb)
    INTO v_presunute, v_nahrazene
    FROM vazby;

  -- Čekající úkoly nesené úlomky (funkční index idx_pws_authorized_twin).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'pred_twin_id', s.input_data->>'authorized_twin_id')), '[]'::jsonb)
    INTO v_kroky
    FROM public.production_workflow_steps s
   WHERE (s.input_data->>'authorized_twin_id') = ANY (SELECT u::text FROM unnest(v_ulomky) u)
     AND s.status = 'pending';
  SELECT count(*) INTO v_hotove
    FROM public.production_workflow_steps s
   WHERE (s.input_data->>'authorized_twin_id') = ANY (SELECT u::text FROM unnest(v_ulomky) u)
     AND s.status IS DISTINCT FROM 'pending';

  SELECT count(*) INTO v_relace
    FROM public.twin_relations x
   WHERE x.source_twin_id = ANY (v_ulomky) OR x.target_twin_id = ANY (v_ulomky);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'pred_status', t.status)), '[]'::jsonb)
    INTO v_twiny
    FROM public.twin_entities t WHERE t.id = ANY (v_ulomky);

  v_pocty := jsonb_build_object(
    'vazeb_presunout', jsonb_array_length(v_presunute),
    'vazeb_ukoncit', jsonb_array_length(v_nahrazene),
    'kroku_prepojit', jsonb_array_length(v_kroky),
    'kroku_hotovych_zustava', v_hotove,
    'zaznamu_archivovat', jsonb_array_length(v_twiny),
    'relaci_zustava', v_relace);

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'pocty', v_pocty);
  END IF;

  IF coalesce(btrim(p_duvod), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duvod_je_povinny');
  END IF;

  v_decision := gen_random_uuid();

  UPDATE public.twin_external_refs r
     SET twin_id = p_kanon, updated_at = now()
    FROM jsonb_to_recordset(v_presunute) AS x(id uuid, pred_twin_id uuid)
   WHERE r.id = x.id;

  UPDATE public.twin_external_refs r
     SET state = 'superseded', valid_to = now(), updated_at = now()
    FROM jsonb_to_recordset(v_nahrazene) AS x(id uuid, pred_state text)
   WHERE r.id = x.id;

  UPDATE public.production_workflow_steps s
     SET input_data = jsonb_set(s.input_data, '{authorized_twin_id}', to_jsonb(p_kanon::text))
    FROM jsonb_to_recordset(v_kroky) AS x(id uuid, pred_twin_id text)
   WHERE s.id = x.id AND s.status = 'pending';

  UPDATE public.twin_entities t
     SET status = 'archived',
         metadata = COALESCE(t.metadata, '{}'::jsonb)
                    || jsonb_build_object('archivovano_rozhodnutim', v_decision::text,
                                          'sjednoceno_do', p_kanon::text),
         updated_at = now()
   WHERE t.id = ANY (v_ulomky);

  -- Jméno zvolené člověkem se zamkne (a zapamatuje, KTERÉ rozhodnutí ho zamklo —
  -- vrácení ho pak odemkne jen tehdy, když ho nezamklo jiné rozhodnutí).
  UPDATE public.twin_entities t
     SET metadata = COALESCE(t.metadata, '{}'::jsonb)
                    || jsonb_build_object('label_hr', t.label, 'label_hr_rozhodnutim', v_decision::text),
         updated_at = now()
   WHERE t.id = p_kanon AND NOT (COALESCE(t.metadata, '{}'::jsonb) ? 'label_hr');

  INSERT INTO public.audit_journal (id, user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details, metadata)
  VALUES (v_decision, v_hr, 'twin.person_unified', 'update', 'twin',
          'twin_decision', v_decision::text,
          format('Sjednocení osoby (%s): %s úlomků, %s vazeb převedeno, %s ukončeno, %s úkolů přepojeno — %s',
                 v_kanon.entity_type, jsonb_array_length(v_twiny), jsonb_array_length(v_presunute),
                 jsonb_array_length(v_nahrazene), jsonb_array_length(v_kroky), p_duvod),
          jsonb_build_object('kanon', p_kanon, 'duvod', p_duvod, 'vratne', true,
                             'kriterium', jsonb_build_object('rozhodl', 'hr', 'druh', v_kanon.entity_type),
                             'pocty', v_pocty,
                             'archivovane_twiny', v_twiny,
                             'presunute_vazby', v_presunute,
                             'nahrazene_vazby', v_nahrazene,
                             'prepojene_kroky', v_kroky),
          jsonb_build_object('kanon', p_kanon));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', v_decision, 'pocty', v_pocty);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_sjednot_osobu_admin(uuid, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_sjednot_osobu_admin(uuid, uuid[], text, boolean) TO authenticated;
