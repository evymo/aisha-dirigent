-- ============================================================================
-- Source of Truth: enrol_kiosk_device
-- Popis: TABLET v kiosku ohlásí svůj průkaz (klíč VER 2) SÁM, bez přihlášeného
--        člověka. Průkaz vznikne jako ČEKAJÍCÍ; schvaluje ho vždy správce
--        (admin_set_knock_device_approval) — ohlášení nic neschvaluje.
-- Bezpečnost: SECURITY DEFINER, JEN služba (brána). Brána volá až po ověření:
--   · adresa požadavku je právě OTEVŘENÁ zaťukáním (svc-knock /dvere = 204) —
--     tablet se ohlašuje ze sítě, kam ho pustil technik svým kódem,
--   · požadavek je PODEPSANÝ klíčem, který ohlašuje (AISHA-REQ1, knock-protocol)
--     — kdo ohlašuje, klíč opravdu drží.
--
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-28): „po kliknutí na zavedení zařízení se klíč
--    odešle na backend, protože je odemčeno, a následně to zařízení můžeme
--    permanentně v administraci schválit, aby si tablet mohl ťukat sám bez
--    zadávání kódu." Průkaz vždy schvaluje správce v seznamu tabletů, které se
--    ohlásily (rozhodnutí 26. 9.) — žádné automatické schválení.
--
-- ⛔ OHLÁŠENÍ NIKDY NEMĚNÍ STAV SCHVÁLENÍ. Existující `kid` jen obnoví „naposledy
--    viděn", adresu a verze; odvolaný průkaz se ohlášením NEOBNOVÍ (jinak by
--    odvolání šlo obejít opakovaným ohlášením) a osobní průkaz se NEPŘEPÍŠE na
--    průkaz tabletu.
-- ⛔ STROP NA ADRESU: z jedné adresy nejvýš 20 nových tabletů za hodinu. Ohlášení
--    je bez přihlášení; bez stropu by šlo zaplavit seznam ke schválení.
--
-- Kontrakt: (text, text, text, inet, jsonb) -> jsonb {ok, stav, kid} | {ok:false, error}
--   stav: 'ceka' | 'schvaleno' | 'odvolano'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enrol_kiosk_device(
  p_kid text,
  p_public_key_hex text,
  p_scope text,
  p_ip inet,
  p_verze jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_radek public.knock_device_credentials%ROWTYPE;
  v_novych int;
BEGIN
  IF NOT (SELECT public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_public_key_hex IS NULL OR p_public_key_hex !~ '^04[0-9a-f]{128}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'public_key_hex musí být SEC1 nekomprimovaný bod (04 || X || Y, 65 B)');
  END IF;
  IF p_kid IS DISTINCT FROM 'dev-' || substring(p_public_key_hex from 3 for 16) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'kid neodpovídá klíči');
  END IF;
  IF p_scope IS NULL OR length(p_scope) = 0 OR length(p_scope) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'scope je povinný');
  END IF;
  IF p_ip IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'adresa ohlášení je povinná');
  END IF;
  IF p_verze IS NOT NULL AND (jsonb_typeof(p_verze) <> 'object' OR length(p_verze::text) > 1024) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'verze musí být malý objekt');
  END IF;

  SELECT * INTO v_radek FROM public.knock_device_credentials WHERE kid = p_kid;
  IF FOUND THEN
    UPDATE public.knock_device_credentials
       SET last_seen_at = now(),
           ohlaseno_z_ip = CASE WHEN druh = 'tablet' THEN p_ip ELSE ohlaseno_z_ip END,
           verze = CASE WHEN druh = 'tablet' THEN COALESCE(p_verze, verze) ELSE verze END,
           updated_at = now()
     WHERE kid = p_kid;
    RETURN jsonb_build_object(
      'ok', true,
      'kid', p_kid,
      'stav', CASE
        WHEN v_radek.revoked_at IS NOT NULL THEN 'odvolano'
        WHEN v_radek.approved_at IS NOT NULL THEN 'schvaleno'
        ELSE 'ceka'
      END
    );
  END IF;

  SELECT count(*) INTO v_novych
    FROM public.knock_device_credentials
   WHERE druh = 'tablet' AND ohlaseno_z_ip = p_ip AND first_seen_at > now() - interval '1 hour';
  IF v_novych >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'z této adresy se za hodinu ohlásilo příliš mnoho tabletů');
  END IF;

  INSERT INTO public.knock_device_credentials (kid, public_key_hex, scope, owner_user_id, druh, ohlaseno_z_ip, verze)
  VALUES (p_kid, p_public_key_hex, p_scope, NULL, 'tablet', p_ip, p_verze);

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (NULL, 'knock_device_enrolled', jsonb_build_object('kid', p_kid, 'druh', 'tablet', 'scope', p_scope));

  RETURN jsonb_build_object('ok', true, 'kid', p_kid, 'stav', 'ceka');
END;
$function$;

REVOKE ALL ON FUNCTION public.enrol_kiosk_device(text, text, text, inet, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enrol_kiosk_device(text, text, text, inet, jsonb) TO service_role;
