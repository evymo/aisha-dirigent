-- ============================================================================
-- Function: kiosk_krok_nasi_flotily(p_input jsonb) → boolean
-- Patří krok (jeho input_data) NAŠÍ flotile — řidiči nebo vozidlu spárovanému
-- s Webdispečinkem? Jediný rozhodce „čí“ pro tablet (účet zařízení).
-- ============================================================================
-- ⭐ MAJITEL 2026-09-30 (přes RIQi): „podle SPZ a podle řidiče, z našich řidičů —
--    co máme spárované s Webdispečinkem. To, že je to naše doprava, má pomáhat
--    ingestu, ale nemá si to sám řešit tablet.“
--
-- Krok patří naší flotile, když platí ALESPOŇ jedno:
--   ŘIDIČ    — dvojče řidiče z dodáku (`authorized_twin_id`, vazbu dělá ingest) je DRUHU
--              `driver` a má POTVRZENÉ, právě platné párování s Webdispečinkem
--              (`webdispecink` / `primary_id` / `ridic:<id>`).
--   VOZIDLO  — SPZ z dodáku (`vehicle_registration`, tahač = první část, `kiosk_tahac`)
--              je SPZ aktivního vozidla Webdispečinku, jehož párování na dvojče DRUHU
--              `vehicle` je POTVRZENÉ a právě platné (`webdispecink` / `primary_id` /
--              `wd_car_id`).
--
-- ⛔ JEN POTVRZENÉ PÁROVÁNÍ (pravidlo majitele): shoda jména nebo SPZ z dodáku sama
--    o sobě nic neznamená — návrh sjednocení dělá ingest a schvaluje člověk
--    (`twin_identity_confirm_binding`). `proposed` / `rejected` / `superseded`
--    ani párování mimo platnost (valid_from/valid_to) tablet nepustí.
-- ⛔ DRUH ENTITY JE SOUČÁST KLÍČE (09-27: vozidlo 5 kolidovalo s osobou 5): SPZ se
--    páruje jen na dvojče vozidla, klíč řidiče jen na dvojče řidiče.
-- ⛔ SPZ SE BERE ZE STRANY WEBDISPEČINKU (`wd_vehicles.identifier`, evidence flotily),
--    ne z vazeb navržených ingestem — ty jsou `proposed` a podle pravidla výše nestačí.
--    `identifier` je „SPZ nebo název“: název se se SPZ z dodáku nepotká a vozidlo tím
--    poctivě vypadne (řidičova větev ho může pokrýt).
--
-- Bez párování (dnes 0 odkazů Webdispečinku) je výsledek false → tablet je poctivě
-- prázdný, žádný návrat k „všichni“.
--
-- Klient ji volat nesmí (byla by to věštírna „je tahle SPZ naše?“): volá ji jen definer
-- predikátu viditelnosti (`workflow_step_visible_to`, větev zařízení).
--
-- plpgsql, ne sql: tělo SQL funkce se ověřuje při CREATE a na čisté DB (baseline) by se
-- tahle funkce mohla založit dřív než `kiosk_tahac`, na kterou sahá.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.kiosk_krok_nasi_flotily(p_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN (
  WITH krok AS (
    SELECT CASE
             WHEN (p_input->>'authorized_twin_id') ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
               THEN (p_input->>'authorized_twin_id')::uuid
           END AS ridic,
           public.kiosk_tahac(p_input->>'vehicle_registration') AS tahac
  )
  SELECT EXISTS (
           SELECT 1
             FROM krok k
             JOIN public.twin_entities t ON t.id = k.ridic
             JOIN public.twin_external_refs r ON r.twin_id = t.id
            WHERE t.entity_type = 'driver'
              AND t.status = 'active'
              AND r.source = 'webdispecink'
              AND r.ref_kind = 'primary_id'
              AND r.source_key LIKE 'ridic:%'
              AND r.state = 'confirmed'
              AND r.valid_from <= now()
              AND (r.valid_to IS NULL OR r.valid_to > now()))
      OR EXISTS (
           SELECT 1
             FROM krok k
             JOIN public.wd_vehicles v ON public.kiosk_tahac(v.identifier) = k.tahac
             JOIN public.twin_external_refs r ON r.source = 'webdispecink'
                                            AND r.ref_kind = 'primary_id'
                                            AND r.source_key = v.wd_car_id::text
             JOIN public.twin_entities t ON t.id = r.twin_id
            WHERE k.tahac IS NOT NULL
              AND v.active
              AND t.entity_type = 'vehicle'
              AND t.status = 'active'
              AND r.state = 'confirmed'
              AND r.valid_from <= now()
              AND (r.valid_to IS NULL OR r.valid_to > now()))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kiosk_krok_nasi_flotily(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_krok_nasi_flotily(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_krok_nasi_flotily(jsonb) TO service_role;
