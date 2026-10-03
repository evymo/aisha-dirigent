-- Function: public.twin_accounts_missing
-- Arguments: p_entity_type text, p_limit integer, p_hledat text
-- Security: SECURITY DEFINER, jen admin/staff nebo service_role (PII)
--
-- Pracovní seznam správce: KDO MÁ TWIN, ALE NEMÁ ÚČET.
--
-- ⭐ ZADÁNÍ MAJITELE (2026-09-10): „ingest má identifikovat, kdo by měl mít
-- účet, ale potřebujeme ho spřáhnout s tím twinem, aby viděl věci, co má."
-- Ingest tedy dodá OSOBU (twin + `primary_id` vazby na zdroje); tenhle seznam
-- říká, u koho ještě chybí druhá půlka — vazba na účet.
--
-- ⛔ ŽÁDNÁ NOVÁ ENTITA. Seznam je ODVOZENÝ, ne uložený: „nemá účet" je
-- nepřítomnost potvrzené `account` vazby, ne vlastnost k zapsání. Uložený
-- příznak by se rozešel s vazbami při prvním schválení mimo tuhle cestu.
--
-- ⛔ `entity_type` SE NEDOSAZUJE. Typy vznikají z dat (`twin_parameter_definitions`,
-- `metadata->>'ingest_field'`), ne z konstant v kódu — „parametry rozhodují,
-- čím entita je". Napsat sem `'driver'` natvrdo by znamenalo, že seznam
-- v instanci s jiným pojmenováním tiše vrátí prázdno. Filtr je proto parametr,
-- stejně jako u `twin_identity_list_unmatched`.
--
-- ⛔ TOHLE NENÍ DRUHÁ CESTA K ZÁPISU. Vazby navrhuje INGEST
-- (`twin-producer.ts` → `twin_identity_propose_binding`) a potvrzuje je člověk
-- v review lane (`get_twin_ref_review_block`). Tahle funkce jen ČTE — odpovídá
-- na otázku, kterou review lane neumí: ne „co čeká na potvrzení", ale „o kom
-- nikdo nenavrhl NIC". Bez toho se nedá rozhodnout, komu poslat pozvánku.
--
-- ⭐ TŘI ODPOVĚDI, NE JEDNA. Správce se u každé osoby rozhoduje mezi
-- „přiděl existující účet" a „pošli pozvánku" (zadání majitele 2026-09-10),
-- a k tomu potřebuje vědět, jestli se o to už někdo nepostaral:
--   · `refs`        — čím je člověk doložený ve zdrojích (kdo to je),
--   · `pozvanky`    — už se poslalo, čeká se na uplatnění,
--   · `navrhy_uctu` — ingest něco navrhl, chce to ratifikaci.
--
-- ⭐ VRACÍ I ZDROJOVÉ VAZBY. Bez nich se rozhodnout NEDÁ: `label` je jméno,
-- a jmen bývá víc stejných. Teprve `source_key` (osobní číslo, id ve
-- Webdispečinku) člověka jednoznačně určí.

--
-- ⭐ HLEDÁNÍ NA SERVERU + ÚKOLY (2026-09-23, HR obrazovka „Lidé a účty").
--   · `p_hledat` — řidičů je v instanci přes tisíc (1 479 twinů, 09-15) a strop
--     500 by seznam TIŠE uřízl: správce by hledal člověka, který „není", protože
--     je až za hranou. Hledá se ve jméně i v klíčích zdrojů (osobní číslo, id
--     ve Webdispečinku) — jmen bývá víc stejných, klíč je jednoznačný.
--   · `limitovano` — true, když za hranou další osoby jsou. „Našlo se 500" a
--     „našlo se všech 500" jsou dvě různé odpovědi a UI je musí rozlišit.
--   · `kroky` — kolik úkolů (lidských kroků workflow) nese twin jako
--     `authorized_twin_id`, a kolik z nich ČEKÁ. Podle toho správce pozná, který
--     z úlomků téhož člověka je ten „hlavní" (09-15: „KOŽUŠNÍK" 2 709 × „p.
--     Kožušník" 1). Počítá se přes funkční index `idx_pws_authorized_twin`
--     (výraz musí sedět PŘESNĚ — cast je na naší straně, ne na indexované).
--     Žádný kód kroku se NEDOSAZUJE: kroky jsou data šablony instance.
CREATE OR REPLACE FUNCTION public.twin_accounts_missing(
  p_entity_type text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_hledat text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_items jsonb;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_limitovano boolean := false;
  -- Hledaný text jako TEXT, ne jako vzor-jazyk: `%` a `_` v zadání jsou znaky.
  v_vzor text := CASE WHEN p_hledat IS NULL OR btrim(p_hledat) = '' THEN NULL
                      ELSE '%' || replace(replace(replace(btrim(p_hledat), '\', '\\'), '%', '\%'), '_', '\_') || '%'
                 END;
BEGIN
  IF NOT ((SELECT public.is_service_role()) OR (SELECT public.is_admin_or_staff())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'twin_label'), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT jsonb_build_object(
             'twin_id', t.id,
             'twin_label', t.label,
             'entity_type', t.entity_type,
             'status', t.status,
             -- Čím je člověk doložený ve zdrojích — podklad pro rozhodnutí.
             'refs', COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                          'source', r.source, 'source_key', r.source_key,
                          'ref_kind', r.ref_kind, 'state', r.state)
                        ORDER BY r.source)
                  FROM public.twin_external_refs r
                 WHERE r.twin_id = t.id
                   AND r.ref_kind <> 'account'
                   AND r.state = 'confirmed'
                   AND (r.valid_to IS NULL OR r.valid_to > now())),
               '[]'::jsonb),
             -- ⭐ ROZESLANÉ POZVÁNKY. Bez nich by správce viděl „nemá účet"
             -- a pozval člověka podruhé — twin totiž zůstává v seznamu, dokud
             -- pozvánku někdo neuplatní, a to je správně (dokud ji neuplatnil,
             -- účet opravdu nemá). Rozdíl mezi „nikdo se o to nepostaral"
             -- a „čeká se na člověka" musí být VIDĚT, jinak se z toho stane
             -- fronta, kterou nikdo nedočte.
             'pozvanky', COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                          'invitation_id', i.id, 'email', i.email,
                          'created_at', i.created_at, 'expires_at', i.expires_at,
                          'used_count', i.used_count, 'is_active', i.is_active)
                        ORDER BY i.created_at DESC)
                  FROM public.invitations i
                 WHERE i.twin_id = t.id),
               '[]'::jsonb),
             -- Návrhy účtu, které čekají na ratifikaci. Prázdné pole =
             -- nenavrhl nikdo, tedy práce pro člověka od nuly.
             'navrhy_uctu', COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                          'ref_id', r.id, 'source_key', r.source_key,
                          'proposed_by', r.proposed_by, 'confidence', r.confidence)
                        ORDER BY r.confidence DESC NULLS LAST)
                  FROM public.twin_external_refs r
                 WHERE r.twin_id = t.id
                   AND r.ref_kind = 'account'
                   AND r.state = 'proposed'),
               '[]'::jsonb),
             -- Úkoly nesené tímhle twinem (viz hlavička: výběr hlavního úlomku).
             'kroky', (SELECT jsonb_build_object(
                                'celkem', count(*),
                                'ceka', count(*) FILTER (WHERE s.status = 'pending'))
                         FROM public.production_workflow_steps s
                        WHERE (s.input_data->>'authorized_twin_id') = t.id::text)
           ) AS x
      FROM public.twin_entities t
     WHERE (p_entity_type IS NULL OR t.entity_type = p_entity_type)
       AND t.status = 'active'
       AND (v_vzor IS NULL
            OR t.label ILIKE v_vzor
            OR EXISTS (SELECT 1 FROM public.twin_external_refs r
                        WHERE r.twin_id = t.id
                          AND r.ref_kind <> 'account'
                          AND r.state = 'confirmed'
                          AND r.source_key ILIKE v_vzor))
       -- ⛔ JÁDRO PODMÍNKY: nemá POTVRZENOU a PLATNOU vazbu na účet.
       -- `valid_to` se počítá: ukončená vazba (řidič odešel) znamená, že
       -- twin účet zase nemá — a musí se v seznamu objevit znovu.
       AND NOT EXISTS (
             SELECT 1 FROM public.twin_external_refs r
              WHERE r.twin_id = t.id
                AND r.ref_kind = 'account'
                AND r.state = 'confirmed'
                AND r.valid_from <= now()
                AND (r.valid_to IS NULL OR r.valid_to > now()))
     ORDER BY t.label
     -- O jeden víc: pozná se tak, jestli za hranou ještě někdo je.
     LIMIT v_limit + 1
  ) s;

  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_limitovano := true;
  END IF;

  RETURN jsonb_build_object('items', v_items, 'count', jsonb_array_length(v_items),
                            'limitovano', v_limitovano);
END;
$$
;

-- Permissions
REVOKE ALL ON FUNCTION public.twin_accounts_missing(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_accounts_missing(text, integer, text) TO authenticated, service_role;

-- Stará signatura musí ZMIZET: s DEFAULT u nového parametru by volání se dvěma
-- argumenty bylo nejednoznačné (42725) — nebo hůř, trefilo by starou verzi bez
-- hledání a bez úkolů.
DROP FUNCTION IF EXISTS public.twin_accounts_missing(text, integer);
