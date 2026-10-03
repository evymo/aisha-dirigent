-- ============================================================================
-- Source of Truth: kiosk_vydej_relaci
-- Popis: Vydání RELACE TABLETU (F2-B) — průkaz → účet zařízení. Volá JEN gateway
--        (`POST /auth/v1/device/session`), a to AŽ PO ověření podpisu AISHA-REQ1
--        klíčem z průkazu: zápis (audit, last_seen) tedy nespustí nikdo, kdo klíč
--        nedrží. Veřejný klíč si gateway bere předem z `kiosk_device_stav`.
--
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-29): „po validaci otisku resp. zařazení, jeho podpis
--    resp. klepání odemyká … a následně je možnost se dostat do aplikace bez přihlášení
--    pouze k našim dodákům“. Klíč zůstává z ohlášení (Keystore = navazující úkol).
--
-- ⛔ PLATNOST SE KONTROLUJE TADY I PŘI KAŽDÉM VOLÁNÍ S RELACÍ. Vydaná relace je krátká
--    (gateway: nejvýš 15 min, nikdy za `plati_do`), ale ani ta nic neotevře po odvolání:
--    pátá cesta workflow_step_visible_to ověřuje průkaz (je_ucet_zarizeni_platny) při
--    KAŽDÉM volání. Relace je jen „kdo mluví“, ne „co smí“.
--
-- Vrací: {ok:true, ucet_id, kid, plati_do} | {ok:false, duvod: nezname|ceka|odvolano|neplatne}
-- Bezpečnost: SECURITY DEFINER, JEN service_role (žádný grant klientům).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kiosk_vydej_relaci(p_kid text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_d public.knock_device_credentials%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_d FROM public.knock_device_credentials WHERE kid = p_kid AND druh = 'tablet';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'duvod', 'nezname');
  END IF;
  IF v_d.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'duvod', 'odvolano');
  END IF;
  IF v_d.approved_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'duvod', 'ceka');
  END IF;
  -- Účet i platnost stejnou funkcí, jakou ověřuje pátá cesta — jedno pravidlo, ne dvě.
  IF v_d.ucet_id IS NULL OR NOT public.je_ucet_zarizeni_platny(v_d.ucet_id) THEN
    RETURN jsonb_build_object('ok', false, 'duvod', 'neplatne');
  END IF;

  UPDATE public.knock_device_credentials SET last_seen_at = now() WHERE kid = p_kid;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_d.ucet_id, 'knock_device_session_issued', jsonb_build_object('kid', p_kid));

  RETURN jsonb_build_object('ok', true, 'ucet_id', v_d.ucet_id, 'kid', p_kid, 'plati_do', v_d.plati_do);
END;
$function$;

REVOKE ALL ON FUNCTION public.kiosk_vydej_relaci(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_vydej_relaci(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_vydej_relaci(text) TO service_role;
