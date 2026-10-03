-- ============================================================================
-- Source of Truth: get_kiosk_rozvozy
-- Popis: DNEŠNÍ ROZVOZY PRO TABLET (F2-C) — výběr „podle řidiče“ nebo „podle vozidla“
--        a seznam kroků k předání. Volá JEN účet zařízení s platným průkazem
--        (relace F2-B); člověk ani admin tudy nejde (mají své bloky).
--
-- ⭐ Majitel 2026-09-29: „Obojí na výběr“ (řidič i vozidlo); „jen k našim dodákům“;
--    osobní údaje odběratele na tablet NEJDOU.
--
-- VIDITELNOST: o každém kroku rozhoduje JEDINÝ rozhodovač workflow_step_visible_to
--   (pátá cesta: účet zařízení + aktivní řádek kiosk_rozsah — u `jen_flotila` jen NAŠE
--   flotila spárovaná s Webdispečinkem — + platný průkaz). Tady se jen LEVNĚ předvybírají kandidáti (okno,
--   kódy kroků z rozsahu), aby se predikát volal nad desítkami řádků, ne nad historií.
--
-- ⭐ NEDORUČENÉ, NE JEN DNEŠNÍ (majitel 2026-09-30: „minimálně dodáky, o kterých víme,
--   že jsou nedodané, podle řidičů a podle aut“): nevyřízený krok (pending/in_progress)
--   s production_date v okně [dnes − okno_zpet, dnes + okno_dopredu] řádku rozsahu,
--   plus kroky dnes dokončené. Výchozí okno 0/0 = jen dnešek (chování F2).
--   Doklad, který zdroj hlásí jako vyřízený (`zdroj_stav` řádku, tvar `source_state`
--   bloku řidičovy pásky), mezi nedoručenými NENÍ — týž význam jako na pásce řidiče.
--   Fail-open jako tam: bez ukazatele na doklad nebo bez řádku registru krok zůstává.
--
-- PROJEKCE: z input_data jde ven JEN to, co pustí kiosk_projekce (`pole` řádků rozsahu,
--   které krok pokrývají). Výběr podle řidiče/vozidla je dostupný, JEN když rozsah dané pole
--   pustí (driver_name / vehicle_registration) — seznam jmen je taky projekce.
--
-- VOZIDLO = TAHAČ: vehicle_registration nese i soupravu („1T2 3456/2T3 4567“, „…+…“).
--   Tahač = první část před / , + ; velká písmena A–Z0–9 (měření RIQi 29. 9.).
--
-- Parametry: p_rezim NULL → nabídka {ridici[], vozidla[]}; 'ridic'|'vozidlo' + p_hodnota
--   → {rozvozy[]}. Okno: z řádků rozsahu (viz výše) + dnes dokončené.
-- Bezpečnost: SECURITY DEFINER, grant authenticated (rozhoduje stráž níž).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kiosk_rozvozy(p_rezim text DEFAULT NULL, p_hodnota text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_vysledek jsonb;
BEGIN
  IF v_me IS NULL OR NOT public.je_ucet_zarizeni_platny(v_me) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'jen_zarizeni');
  END IF;
  IF p_rezim IS NOT NULL AND p_rezim NOT IN ('ridic', 'vozidlo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rezim');
  END IF;
  IF p_rezim IS NOT NULL AND nullif(btrim(coalesce(p_hodnota, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hodnota');
  END IF;

  WITH okno AS (
    -- Vnější mez pro index: nejširší okno ze všech aktivních řádků.
    SELECT coalesce(max(r.okno_zpet), 0) AS zpet, coalesce(max(r.okno_dopredu), 0) AS dopredu
      FROM public.kiosk_rozsah r
     WHERE r.aktivni
  ),
  predvyber AS (
    SELECT s.id, s.step_code, s.status, s.completed_at, s.input_data, s.assigned_user_id, s.assigned_role, b.production_date
      FROM public.production_workflow_steps s
      JOIN public.production_batches b ON b.id = s.batch_id
      CROSS JOIN okno o
     WHERE s.step_code IN (SELECT r.step_code FROM public.kiosk_rozsah r WHERE r.aktivni)
       AND ((s.status IN ('pending', 'in_progress')
             AND b.production_date BETWEEN current_date - o.zpet AND current_date + o.dopredu)
            OR (s.status = 'completed' AND s.completed_at::date = current_date))
  ),
  kandidati AS (
    -- Okno a stav zdroje podle řádků, které krok SKUTEČNĚ pouštějí — stejná podmínka jako
    -- větev zařízení predikátu (step_code + zúžení + u `jen_flotila` naše flotila).
    SELECT p.*, cfg.zdroj_stav
      FROM predvyber p
      CROSS JOIN LATERAL (
        SELECT max(r.okno_zpet) AS zpet,
               max(r.okno_dopredu) AS dopredu,
               (array_agg(r.zdroj_stav ORDER BY r.kod) FILTER (WHERE r.zdroj_stav <> '{}'::jsonb))[1] AS zdroj_stav
          FROM public.kiosk_rozsah r
         WHERE r.aktivni
           AND r.step_code = p.step_code
           AND coalesce(p.input_data, '{}'::jsonb) @> r.input_match
           AND (NOT r.jen_flotila OR public.kiosk_krok_nasi_flotily(coalesce(p.input_data, '{}'::jsonb)))
      ) cfg
     WHERE cfg.zpet IS NOT NULL
       AND (p.status = 'completed'
            OR p.production_date BETWEEN current_date - cfg.zpet AND current_date + cfg.dopredu)
  ),
  nedorucene AS (
    -- Stav dokladu ze zdroje: TÝŽ ukazatel napřed, identita až potom, jako páska řidiče
    -- (get_workflow_my_steps_block) — obě čtení míří na částečné indexy registru
    -- (`superseded_by IS NULL`: doc_slug btree, fields GIN jsonb_path_ops).
    SELECT k.*
      FROM kandidati k
      LEFT JOIN LATERAL (
        SELECT reg.fields
          FROM public.li_source_registry reg
         WHERE k.zdroj_stav IS NOT NULL
           AND reg.superseded_by IS NULL
           AND reg.doc_slug = k.input_data->>'doc_slug'
         ORDER BY reg.ingested_at DESC
         LIMIT 1
      ) src_ptr ON true
      LEFT JOIN LATERAL (
        SELECT reg.fields
          FROM public.li_source_registry reg
         WHERE src_ptr.fields IS NULL
           AND k.zdroj_stav ? 'stable_key'
           AND nullif(k.input_data->>(k.zdroj_stav->>'stable_key'), '') IS NOT NULL
           AND reg.superseded_by IS NULL
           AND reg.fields @> jsonb_build_object(
                 k.zdroj_stav->>'stable_key',
                 jsonb_build_object('value', k.input_data->>(k.zdroj_stav->>'stable_key')))
         ORDER BY reg.ingested_at DESC
         LIMIT 1
      ) src_id ON true
     WHERE k.status = 'completed'
        OR k.zdroj_stav IS NULL
        OR lower(coalesce(coalesce(src_ptr.fields, src_id.fields) -> (k.zdroj_stav->>'field') ->> 'value', ''))
           IS DISTINCT FROM lower(k.zdroj_stav->>'closed_when')
  ),
  videne AS (
    SELECT k.*,
           -- Projekce: JEDINÉ pravidlo, co smí na tablet (kiosk_projekce).
           public.kiosk_projekce(k.step_code, k.input_data) AS proj
      FROM nedorucene k
     WHERE public.workflow_step_visible_to(v_me, k.assigned_user_id, k.assigned_role, k.input_data, NULL, k.step_code)
  ),
  s_pohledem AS (
    -- Řidič i tahač se berou z PROMÍTNUTÉHO objektu: co rozsah nepustí, nejde ani do nabídky.
    SELECT v.*,
           nullif(btrim(v.proj->>'driver_name'), '') AS ridic,
           public.kiosk_tahac(v.proj->>'vehicle_registration') AS tahac
      FROM videne v
  )
  SELECT CASE
           WHEN p_rezim IS NULL THEN jsonb_build_object(
             'ok', true,
             'ridici', coalesce((SELECT jsonb_agg(jsonb_build_object('hodnota', x.ridic, 'k_predani', x.k, 'hotovo', x.h) ORDER BY x.ridic)
                                   FROM (SELECT ridic, count(*) FILTER (WHERE status <> 'completed') AS k,
                                                count(*) FILTER (WHERE status = 'completed') AS h
                                           FROM s_pohledem WHERE ridic IS NOT NULL GROUP BY ridic) x), '[]'::jsonb),
             'vozidla', coalesce((SELECT jsonb_agg(jsonb_build_object('hodnota', x.tahac, 'k_predani', x.k, 'hotovo', x.h) ORDER BY x.tahac)
                                    FROM (SELECT tahac, count(*) FILTER (WHERE status <> 'completed') AS k,
                                                 count(*) FILTER (WHERE status = 'completed') AS h
                                            FROM s_pohledem WHERE tahac IS NOT NULL GROUP BY tahac) x), '[]'::jsonb))
           ELSE jsonb_build_object(
             'ok', true,
             'rezim', p_rezim,
             'hodnota', p_hodnota,
             'rozvozy', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                     'id', sp.id,
                                     'step_code', sp.step_code,
                                     'stav', sp.status,
                                     'dokonceno', sp.completed_at,
                                     'den', sp.production_date,
                                     'pole', sp.proj)
                                   ORDER BY (sp.status = 'completed'), sp.completed_at, sp.id)
                                    FROM s_pohledem sp
                                   WHERE (p_rezim = 'ridic' AND sp.ridic = btrim(p_hodnota))
                                      OR (p_rezim = 'vozidlo' AND sp.tahac = public.kiosk_tahac(p_hodnota))), '[]'::jsonb))
         END
    INTO v_vysledek;

  RETURN v_vysledek;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_kiosk_rozvozy(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kiosk_rozvozy(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_rozvozy(text, text) TO service_role;
