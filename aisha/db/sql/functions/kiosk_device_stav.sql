-- ============================================================================
-- Source of Truth: kiosk_device_stav
-- Popis: Stav průkazu zařízení pro samotné zařízení (tablet čeká na schválení
--        a ptá se, jestli už smí klepat sám) a veřejný klíč pro ověření jeho
--        podepsaného požadavku v bráně.
-- Bezpečnost: SECURITY DEFINER, JEN služba (brána). Tablet se ptá přes bránu
--             podepsaným požadavkem; bez podpisu klíčem `kid` odpověď nedostane.
--
-- Kontrakt: (text) -> jsonb {ok, stav, public_key_hex} | {ok:false, error:'nezname'}
--   stav: 'ceka' | 'schvaleno' | 'odvolano'
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kiosk_device_stav(p_kid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_radek public.knock_device_credentials%ROWTYPE;
BEGIN
  IF NOT (SELECT public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT * INTO v_radek FROM public.knock_device_credentials WHERE kid = p_kid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nezname');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'public_key_hex', v_radek.public_key_hex,
    'stav', CASE
      WHEN v_radek.revoked_at IS NOT NULL THEN 'odvolano'
      WHEN v_radek.approved_at IS NOT NULL THEN 'schvaleno'
      ELSE 'ceka'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kiosk_device_stav(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_device_stav(text) TO service_role;
