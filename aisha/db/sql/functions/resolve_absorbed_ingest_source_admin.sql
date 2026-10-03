-- ============================================================================
-- Source of Truth: resolve_absorbed_ingest_source_admin
-- Popis: Srovná TWINY se zdrojem, který registr zdrojů už pohltil jiným:
--        duplikáty archivuje, jedinečné vazby převede pod kanonický zdroj,
--        nejasné případy jen vyjmenuje. Jedno ROZHODNUTÍ ČLOVĚKA, vratné.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⛔ PROČ VZNIKLA (naměřeno 2026-09-19 v produkci riq, jen čtením). Přehrání
--    tří balíčků se jménem aplikace `aisha-local-ingest` (30. 8.) založilo
--    839 twinů `company` (21 % všech) vedle twinů `local-ingest` téhož ingestu.
--    2 189 klíčů existuje pod oběma zdroji, pokaždé na JINÝ twin. Registr zdrojů
--    to 2026-09-02 sjednotil pohlcením (config.superseded_by), twiny ne — a ty
--    se „táhly" dál. Majitel: projekt má JEDEN ingest (`local-ingest`).
--
-- ⭐ KRITÉRIUM JE ZDROJ, O JEHOŽ POHLCENÍ UŽ ROZHODL ČLOVĚK. Funkce nerozhoduje,
--    že dvě jména znamenají totéž — to je tvrzení o světě a zapisuje ho
--    set_data_source_config (config.nahrazuje → superseded_by). Tady se jen
--    dotahuje do twinů. Nepohlcený zdroj = odmítnutí, ne odhad.
--
-- ⭐ TŘÍDY TWINŮ (klíče porovnané po normalizaci: jen písmena a číslice, malá):
--    · duplikat — twin nemá žádnou vazbu kanonického zdroje, KAŽDÝ jeho živý klíč
--      drží kanonický zdroj, všechny u JEDNOHO a téhož jiného twinu téhož druhu
--      entity → twin 'archived', jeho vazby pohlceného zdroje 'superseded'.
--    · prevest  — žádný jeho klíč kanonický zdroj jinde nedrží → vazby pohlceného
--      zdroje se převedou pod kanonický; kde už stejnou vazbu (druh + klíč) má
--      týž twin od kanonického zdroje, stará se jen ukončí ('superseded').
--    · nejasne  — všechno ostatní, kde se nějaký klíč potká s jiným twinem:
--      twin má vazby OBOU zdrojů, NEBO jen část jeho klíčů kanonický zdroj zná,
--      NEBO jeho klíče vedou na víc různých twinů, NEBO na twin jiného druhu.
--      To je spor, ne dvojí import → nesahá se, jen se vyjmenuje člověku.
--
-- ⛔ PROČ ÚPLNÁ SHODA (2026-09-28, majitel: „slučovat, pokud máme shodu";
--    „neslučovat jen podle jednoho klíče"). Původně stačil JEDEN shodný klíč:
--    duplikát se archivoval a jeho ostatní klíče (IČO, DIČ, jméno, které
--    kanonický zdroj nezná) se ukončily. Změřeno v produkci riq jen čtením:
--    z 759 twinů bez kanonické vazby má 563 úplnou shodu (1 987 klíčů → vždy
--    týž twin), 37 jen částečnou a 30 klíče u víc twinů. Stará třída by
--    archivovala i těch 67 a ukončila jejich 34 IČO, 36 DIČ a 135 jmen, tedy
--    sloučila firmy podle jediného společného klíče (typicky jména, které
--    v čase může patřit jiné firmě).
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true): počty a ukázka nejasných, nic nezapíše.
-- ⭐ DOHLEDATELNÉ A VRATNÉ: ostrý běh = řádek audit_journal (entity_type
--    'twin_decision', id = decision_id) se stavem PŘED zásahem u každého twinu
--    a každé vazby; twin nese v metadata `archivovano_rozhodnutim`. Vrácení:
--    revert_twin_decision_admin, přehled: get_decisions_admin.
--
-- Kontrakt: (text, text, boolean) ->
--   jsonb {ok, dry_run, decision_id?, zdroj, kanon, twinu:{duplikat,prevest,nejasne},
--          vazeb:{nahradit,prevest,duplikat_bez_protejsku} | {nahrazeno,prevedeno},
--          nejasne_ukazka} | {ok:false, error}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_absorbed_ingest_source_admin(
  p_absorbed_source text,
  p_reason          text,
  p_dry_run         boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kanon     text;
  v_decision  uuid := gen_random_uuid();
  v_tridy     jsonb;
  v_nejasne   jsonb;
  v_n_nahr    integer;
  v_n_prev    integer;
  v_n_zanik   integer;
  v_twiny     jsonb := '[]'::jsonb;
  v_nahrazene jsonb := '[]'::jsonb;
  v_prevedene jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  END IF;
  IF coalesce(btrim(p_absorbed_source), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_absorbed_source je povinný');
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'důvod (p_reason) je povinný — rozhodnutí bez důvodu nejde doložit');
  END IF;

  SELECT btrim(s.config ->> 'superseded_by') INTO v_kanon
    FROM public.agent_knowledge_sources s
   WHERE s.source_slug = p_absorbed_source
     AND NOT s.is_active
     AND coalesce(btrim(s.config ->> 'superseded_by'), '') <> '';
  IF v_kanon IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'zdroj není v registru pohlcený — o pohlcení rozhoduje člověk přes set_data_source_config (config.nahrazuje)');
  END IF;

  -- Živé vazby obou zdrojů s normalizovaným klíčem.
  CREATE TEMPORARY TABLE IF NOT EXISTS _pohl_vazby (
    ref_id uuid PRIMARY KEY, twin_id uuid, ref_kind text, k text, state text, valid_to timestamptz
  ) ON COMMIT DROP;
  CREATE TEMPORARY TABLE IF NOT EXISTS _kanon_vazby (
    twin_id uuid, ref_kind text, k text
  ) ON COMMIT DROP;
  CREATE TEMPORARY TABLE IF NOT EXISTS _pohl_twiny (
    twin_id uuid PRIMARY KEY, trida text
  ) ON COMMIT DROP;
  TRUNCATE _pohl_vazby, _kanon_vazby, _pohl_twiny;

  INSERT INTO _pohl_vazby
  SELECT r.id, r.twin_id, r.ref_kind, lower(regexp_replace(r.source_key, '[^[:alnum:]]', '', 'g')), r.state, r.valid_to
    FROM public.twin_external_refs r
   WHERE r.source = p_absorbed_source AND r.valid_to IS NULL AND r.state IN ('proposed', 'confirmed');

  INSERT INTO _kanon_vazby
  SELECT r.twin_id, r.ref_kind, lower(regexp_replace(r.source_key, '[^[:alnum:]]', '', 'g'))
    FROM public.twin_external_refs r
   WHERE r.source = v_kanon AND r.valid_to IS NULL AND r.state IN ('proposed', 'confirmed');

  -- Třída z ÚPLNÉ shody (viz hlavička): duplikát jen tehdy, když KAŽDÝ živý
  -- klíč twinu drží kanonický zdroj a všechny vedou na JEDEN twin téhož druhu
  -- entity. Částečná shoda, klíče rozdělené mezi víc twinů nebo twin jiného
  -- druhu = spor → nejasne; nikdy archivace podle jednoho klíče.
  WITH par AS (
    SELECT a.twin_id, a.ref_id, c.twin_id AS kanon_twin
      FROM _pohl_vazby a
      LEFT JOIN _kanon_vazby c
        ON c.ref_kind = a.ref_kind AND c.k = a.k AND c.twin_id <> a.twin_id
  ), souhrn AS (
    SELECT twin_id,
           count(DISTINCT ref_id)                                        AS klicu,
           count(DISTINCT ref_id) FILTER (WHERE kanon_twin IS NOT NULL)  AS sparovano,
           count(DISTINCT kanon_twin)                                    AS kanon_twinu,
           min(kanon_twin::text)::uuid                                   AS kanon_twin
      FROM par
     GROUP BY twin_id
  )
  INSERT INTO _pohl_twiny
  SELECT s.twin_id,
         CASE
           WHEN s.sparovano = 0 THEN 'prevest'
           WHEN NOT EXISTS (SELECT 1 FROM _kanon_vazby c WHERE c.twin_id = s.twin_id)
                AND s.sparovano = s.klicu
                AND s.kanon_twinu = 1
                AND (SELECT te.entity_type FROM public.twin_entities te WHERE te.id = s.twin_id)
                    = (SELECT tk.entity_type FROM public.twin_entities tk WHERE tk.id = s.kanon_twin)
             THEN 'duplikat'
           ELSE 'nejasne'
         END
    FROM souhrn s;

  SELECT jsonb_build_object(
           'duplikat', count(*) FILTER (WHERE trida = 'duplikat'),
           'prevest',  count(*) FILTER (WHERE trida = 'prevest'),
           'nejasne',  count(*) FILTER (WHERE trida = 'nejasne'))
    INTO v_tridy FROM _pohl_twiny;
  SELECT coalesce(jsonb_agg(twin_id ORDER BY twin_id), '[]'::jsonb) INTO v_nejasne
    FROM _pohl_twiny WHERE trida = 'nejasne';

  -- Vazby k ukončení: všechny u duplikátů + u převáděných ty, které týž twin
  -- už má od kanonického zdroje (převod by vyrobil dvojí vazbu).
  SELECT count(*) INTO v_n_nahr
    FROM _pohl_vazby a JOIN _pohl_twiny t ON t.twin_id = a.twin_id
   WHERE t.trida = 'duplikat'
      OR (t.trida = 'prevest' AND EXISTS (SELECT 1 FROM _kanon_vazby c
                                           WHERE c.twin_id = a.twin_id AND c.ref_kind = a.ref_kind AND c.k = a.k));
  SELECT count(*) INTO v_n_prev
    FROM _pohl_vazby a JOIN _pohl_twiny t ON t.twin_id = a.twin_id
   WHERE t.trida = 'prevest'
     AND NOT EXISTS (SELECT 1 FROM _kanon_vazby c
                      WHERE c.twin_id = a.twin_id AND c.ref_kind = a.ref_kind AND c.k = a.k);

  -- Klíče duplikátů, které kanonický zdroj NIKDE nezná: ukončením zmizí z živých
  -- vazeb (řádek zůstává jako historie). Náhled je ukazuje, aby o ztrátě
  -- rozhodoval člověk vědomě — rozhodnutí je nepřiřazuje jinému twinu sám.
  SELECT count(*) INTO v_n_zanik
    FROM _pohl_vazby a JOIN _pohl_twiny t ON t.twin_id = a.twin_id
   WHERE t.trida = 'duplikat'
     AND NOT EXISTS (SELECT 1 FROM _kanon_vazby c WHERE c.ref_kind = a.ref_kind AND c.k = a.k);

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'zdroj', p_absorbed_source, 'kanon', v_kanon,
                              'twinu', v_tridy,
                              'vazeb', jsonb_build_object('nahradit', v_n_nahr, 'prevest', v_n_prev,
                                                          'duplikat_bez_protejsku', v_n_zanik),
                              'nejasne_ukazka', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
                                                   FROM (SELECT jsonb_array_elements(v_nejasne) x LIMIT 20) s));
  END IF;

  -- 1) Ukončit vazby (stav a platnost PŘED zásahem jdou do rozhodnutí).
  WITH zmenene AS (
    UPDATE public.twin_external_refs r
       SET state = 'superseded', valid_to = now(), updated_at = now()
      FROM _pohl_vazby a JOIN _pohl_twiny t ON t.twin_id = a.twin_id
     WHERE r.id = a.ref_id
       AND (t.trida = 'duplikat'
            OR (t.trida = 'prevest' AND EXISTS (SELECT 1 FROM _kanon_vazby c
                                                 WHERE c.twin_id = a.twin_id AND c.ref_kind = a.ref_kind AND c.k = a.k)))
    RETURNING r.id, a.state AS pred_state
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'pred_state', pred_state) ORDER BY id), '[]'::jsonb)
    INTO v_nahrazene FROM zmenene;

  -- 2) Převést zbylé vazby převáděných twinů pod kanonický zdroj.
  WITH prevedene AS (
    UPDATE public.twin_external_refs r
       SET source = v_kanon, updated_at = now()
      FROM _pohl_vazby a JOIN _pohl_twiny t ON t.twin_id = a.twin_id
     WHERE r.id = a.ref_id
       AND t.trida = 'prevest'
       AND r.valid_to IS NULL
       AND r.source = p_absorbed_source
    RETURNING r.id
  )
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb) INTO v_prevedene FROM prevedene;

  -- 3) Archivovat duplikáty (stav PŘED zásahem jde do rozhodnutí).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'pred_status', e.status) ORDER BY e.id), '[]'::jsonb)
    INTO v_twiny
    FROM public.twin_entities e JOIN _pohl_twiny t ON t.twin_id = e.id
   WHERE t.trida = 'duplikat';
  UPDATE public.twin_entities e
     SET status = 'archived',
         metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('archivovano_rozhodnutim', v_decision),
         updated_at = now()
    FROM _pohl_twiny t
   WHERE e.id = t.twin_id AND t.trida = 'duplikat';

  INSERT INTO public.audit_journal (id, user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details, metadata)
  VALUES (v_decision, auth.uid(), 'twin.absorbed_source_resolved', 'update', 'twin',
          'twin_decision', v_decision::text,
          format('Pohlcený zdroj %s → %s: archivováno %s twinů, převedeno %s vazeb, ukončeno %s vazeb, nejasných %s — %s',
                 p_absorbed_source, v_kanon, jsonb_array_length(v_twiny), jsonb_array_length(v_prevedene),
                 jsonb_array_length(v_nahrazene), jsonb_array_length(v_nejasne), p_reason),
          jsonb_build_object('zdroj', p_absorbed_source, 'kanon', v_kanon, 'duvod', p_reason,
                             'kriterium', jsonb_build_object(
                               'pohlceny_zdroj', p_absorbed_source, 'kanon', v_kanon,
                               'klic', 'druh vazby + klíč jen z písmen a číslic, malými'),
                             'pocty', jsonb_build_object(
                               'twinu_archivovano', jsonb_array_length(v_twiny),
                               'vazeb_prevedeno', jsonb_array_length(v_prevedene),
                               'vazeb_ukonceno', jsonb_array_length(v_nahrazene),
                               'twinu_nejasnych', jsonb_array_length(v_nejasne)),
                             'twinu', v_tridy, 'archivovane_twiny', v_twiny,
                             'nahrazene_vazby', v_nahrazene, 'prevedene_vazby', v_prevedene,
                             'nejasne_twiny', v_nejasne, 'duplikat_bez_protejsku', v_n_zanik,
                             'vratne', true),
          jsonb_build_object('twinu', v_tridy,
                             'vazeb', jsonb_build_object('nahrazeno', jsonb_array_length(v_nahrazene),
                                                         'prevedeno', jsonb_array_length(v_prevedene))));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', v_decision,
                            'zdroj', p_absorbed_source, 'kanon', v_kanon, 'twinu', v_tridy,
                            'vazeb', jsonb_build_object('nahrazeno', jsonb_array_length(v_nahrazene),
                                                        'prevedeno', jsonb_array_length(v_prevedene)),
                            'nejasne_ukazka', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
                                                 FROM (SELECT jsonb_array_elements(v_nejasne) x LIMIT 20) s));
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_absorbed_ingest_source_admin(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_absorbed_ingest_source_admin(text, text, boolean) TO authenticated, service_role;
