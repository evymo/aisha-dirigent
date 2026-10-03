-- ============================================================================
-- Source of Truth: knock_roster_zarizeni
-- Popis: Klíče SCHVÁLENÝCH a NEODVOLANÝCH zařízení pro dveře (svc-knock), aby
--        schválení v administraci platilo bez ručního exportu rosteru.
-- Bezpečnost: SECURITY DEFINER, JEN služba (brána ho vydává dveřím úzkým tokenem).
--
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): „to zařízení samozřejmě musí umět samo
--    klepat, když je schválené." Mění rozhodnutí z 9. 9. (roster exportuje člověk,
--    scripts/knock-devices-to-roster.mjs) — jeho obavy zůstávají splněné:
--   · VYDÁVAJÍ SE JEN VEŘEJNÉ KLÍČE (VER 2). Žádné sdílené tajemství: záznam bez
--     veřejného klíče tudy neprojde (tabulka ho ani mít nemůže — CHECK tvaru).
--   · ZÁKLAD (kódy techniků, break-glass) zůstává JEN v prostředí dveří a zařízení
--     ho nepřepíše — kolizi `kid` řeší dveře odmítnutím (svc-knock roster).
--   · Dveře nedostanou přístup do databáze; přečtou jen tenhle výstup přes bránu.
--
-- Kontrakt: () -> jsonb {operators: {kid: {publicKeyHex, scopes, kind}}, version, count}
--   version = otisk obsahu (dveře stahují celý roster jen při změně).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.knock_roster_zarizeni()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_operators jsonb;
BEGIN
  IF NOT (SELECT public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(
           jsonb_object_agg(
             d.kid,
             jsonb_build_object('publicKeyHex', d.public_key_hex, 'scopes', jsonb_build_array(d.scope), 'kind', 'device')
             ORDER BY d.kid
           ),
           '{}'::jsonb
         )
    INTO v_operators
    FROM public.knock_device_credentials d
   WHERE d.approved_at IS NOT NULL
     AND d.revoked_at IS NULL;

  RETURN jsonb_build_object(
    'operators', v_operators,
    'version', md5(v_operators::text),
    'count', (SELECT count(*) FROM jsonb_object_keys(v_operators))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.knock_roster_zarizeni() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.knock_roster_zarizeni() TO service_role;
