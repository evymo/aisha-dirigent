-- =============================================================================
-- zarizeni_deklarace_cteni() — deklarace zařízení pro storage-auth.
--
-- Vrací `{ deklarace, commit, zapsano }`, nebo NULL, když instance nic
-- nedeklarovala (schopnost vypnutá). storage-auth ji čte za běhu — při startu,
-- v intervalu srovnání úložiště a při dotazu kiosku na seznam appek.
--
-- ⛔ Jen service role: deklarace nese výbavu tabletu (adresu API, dveře) a otisky
--    balíčků; administrace ji dostává přes storage-auth `/zarizeni/konfigurace`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.zarizeni_deklarace_cteni()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: service_role required' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object('deklarace', d.deklarace, 'commit', d.zdroj_commit, 'zapsano', d.zapsano)
    INTO v
    FROM public.zarizeni_deklarace d
   WHERE d.jedina;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.zarizeni_deklarace_cteni() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zarizeni_deklarace_cteni() TO service_role;
