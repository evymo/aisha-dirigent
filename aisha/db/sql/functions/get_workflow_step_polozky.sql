-- ============================================================================
-- Source of Truth: get_workflow_step_polozky(p_step_id uuid) → jsonb
-- Popis: POLOŽKY DOKLADU KROKU — co, kolik a čeho odvézt — pro toho, kdo KROK vidí.
--
-- ⭐ Majitel 2026-09-30: „v mobilní aplikaci řidiče nevidím detail dodávky/dokladu —
--    co, kolik a čeho odvézt“. Položky na dokladu JSOU (li_source_registry.line_items,
--    RIQi read-only 30. 9.: 17/17 předání v okně tabletu, klíče item_code / item_name /
--    quantity / unit), ale tablet se k nim nedostal: detail kroku mu nevydá doc_slug
--    a registr účtu zařízení žádný doklad neukáže (nárok registru jde přes
--    li_doc_slugs_claimed_by, který rameno zařízení nezná).
--
-- PROČ POLOŽKY JDOU S KROKEM, NE PŘES REGISTR: nárok na KROK už rozhoduje jediný
--   rozhodce (workflow_step_visible_to, tady se stejným rozsahem jako detail kroku).
--   Rozšířit RLS registru o zařízení by otevřelo celý doklad (hlavička, odběratel,
--   částky); tady jde ven JEN seznam položek toho jednoho dokladu, na který ukazuje
--   krok. doc_slug ani registr volající nedostane.
--
-- PROJEKCE: tablet (účet zařízení) dostane z řádku položky JEN klíče `pole_polozek`
--   řádků kiosk_rozsah, které krok pouštějí (stejná podmínka jako větev zařízení
--   predikátu). Prázdné = nic (fail-closed). Člověk s nárokem na krok dostane celý
--   řádek (hodnoty bez provenance). Druhá cesta pro člověka s nárokem na DOKLAD
--   (get_document_detail) zůstává, jak je — tohle ji nenahrazuje ani nezastupuje.
--   Neprázdný řádek nese i `stav_radku` (stav řádku v registru, tj. prošel/neprošel
--   branami), aby povrch mohl přiznat „čeká na kontrolu“ — řádek bez pustitelných
--   klíčů se nevydá vůbec (ani se stavem).
--
-- VERZE DOKLADU: krok nese ukazatel `doc_slug` z doby, kdy vznikl; novější verze
--   dokladu má jiný slug a starou označí `superseded_by`. Položky se proto berou
--   z PLATNÉ verze po řetězu (nejvýš 10 kroků); bez platné verze z poslední známé.
--   Klíč identity dokladu se nehádá — řetěz vede registr sám.
--
-- Vrací {ok, doklad, polozky[]}. Neexistující krok i krok bez nároku = týž
--   {ok:false, error:'nenalezeno'} (žádná věštírna na cizí běhy). Krok bez dokladu
--   v registru = {ok:true, doklad:false, polozky:[]} — poctivé „nevím“, ne chyba.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern (authenticated + service_role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_step_polozky(p_step_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_s        public.production_workflow_steps%rowtype;
  v_zarizeni boolean;
  v_klice    text[] := '{}'::text[];
  v_slug     text;
  v_radky    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nenalezeno');
  END IF;

  SELECT * INTO v_s FROM public.production_workflow_steps s WHERE s.id = p_step_id;
  -- Týž rozsah jako get_workflow_step_detail: kód kroku z ŘÁDKU (pátá cesta — tablet).
  IF NOT FOUND OR NOT public.workflow_step_visible_to(
       v_uid, v_s.assigned_user_id, v_s.assigned_role, v_s.input_data, 'dispatch', v_s.step_code) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nenalezeno');
  END IF;

  -- Příznak zařízení nese SERVER (vazba průkazu), ne klient — jako v detailu kroku.
  v_zarizeni := EXISTS (SELECT 1 FROM public.knock_device_credentials d WHERE d.ucet_id = v_uid);
  IF v_zarizeni THEN
    SELECT coalesce(array_agg(DISTINCT k.klic), '{}'::text[]) INTO v_klice
      FROM public.kiosk_rozsah r
      CROSS JOIN LATERAL unnest(r.pole_polozek) AS k(klic)
     WHERE r.aktivni
       AND r.step_code = v_s.step_code
       AND coalesce(v_s.input_data, '{}'::jsonb) @> r.input_match
       AND (NOT r.jen_flotila OR public.kiosk_krok_nasi_flotily(coalesce(v_s.input_data, '{}'::jsonb)));
  END IF;

  WITH RECURSIVE verze AS (
    SELECT r.doc_slug, r.superseded_by, r.line_items, r.ingested_at, 1 AS hloubka
      FROM public.li_source_registry r
     WHERE r.doc_slug = v_s.input_data->>'doc_slug'
    UNION ALL
    SELECT n.doc_slug, n.superseded_by, n.line_items, n.ingested_at, v.hloubka + 1
      FROM verze v
      JOIN public.li_source_registry n ON n.doc_slug = v.superseded_by
     WHERE v.superseded_by IS NOT NULL
       AND v.hloubka < 10
  )
  SELECT v.doc_slug, v.line_items INTO v_slug, v_radky
    FROM verze v
   ORDER BY (v.superseded_by IS NULL) DESC, v.hloubka DESC, v.ingested_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'doklad', v_slug IS NOT NULL,
    'polozky', coalesce((
      SELECT jsonb_agg(
               CASE WHEN jsonb_typeof(p.stav) = 'string'
                    THEN p.radek || jsonb_build_object('stav_radku', p.stav)
                    ELSE p.radek END
               ORDER BY p.poradi)
        FROM (
          SELECT li.poradi,
                 li.polozka->'status' AS stav,
                 (SELECT coalesce(jsonb_object_agg(f.key, f.value->'value'), '{}'::jsonb)
                    FROM jsonb_each(CASE WHEN jsonb_typeof(li.polozka->'fields') = 'object'
                                         THEN li.polozka->'fields' ELSE '{}'::jsonb END) f
                   WHERE jsonb_typeof(f.value) = 'object'
                     AND f.value ? 'value'
                     AND (NOT v_zarizeni OR f.key = ANY (v_klice))) AS radek
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_radky) = 'array' THEN v_radky ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS li(polozka, poradi)
        ) p
       WHERE p.radek <> '{}'::jsonb), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_workflow_step_polozky(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_step_polozky(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_step_polozky(uuid) TO service_role;
