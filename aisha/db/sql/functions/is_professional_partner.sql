-- Function: public.is_professional_partner
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:54+01:00

CREATE OR REPLACE FUNCTION public.is_professional_partner(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). S pořadím
  -- COALESCE s parametrem na prvním místě vyhrál parametr a přihlášený se pro cizí
  -- uuid dozvěděl, zda je výrobním poskytovatelem. Oprava je fáze 2 z brány
  -- security-hardened-helpers: JWT vyhrává, parametr platí jen pro service_role.
  -- Změřeno, že to nic nerozbije: jediný volající (usePermissions.ts) volá bez
  -- argumentu, tedy za sebe.
  v_user_id := COALESCE(auth.uid(), p_user_id);
  
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM partner_profiles
    WHERE partner_profiles.user_id = v_user_id AND partner_profiles.is_production_provider = true
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_professional_partner(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_professional_partner(p_user_id uuid) TO authenticated;
