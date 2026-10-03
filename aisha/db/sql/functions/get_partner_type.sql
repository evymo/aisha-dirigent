-- Function: public.get_partner_type
-- Arguments: p_user_id uuid
-- Description: Returns the partner classification for a user.
-- Returns: TEXT — one of:
--   'professional'  — certified partner that is a production provider
--   'amateur'       — certified partner without production-provider flag
--   'uncertified'   — has a partner_profiles row but has not been certified
--   NULL            — user has no partner_profiles row (not a partner at all)
-- Possible values: 'professional' | 'amateur' | 'uncertified' | NULL
-- Frontend mirror: src/hooks/usePermissions.ts → type PartnerType
-- Security: SECURITY DEFINER, search_path 'public'. Granted to authenticated.
-- Extracted: 2026-01-08T18:27:17+01:00

CREATE OR REPLACE FUNCTION public.get_partner_type(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner partner_profiles%ROWTYPE;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_partner
  FROM partner_profiles
  WHERE partner_profiles.user_id = v_user_id
    AND (partner_profiles.is_visible = true OR partner_profiles.user_id = auth.uid() OR public.is_admin_or_staff());

  -- No partner profile = not a partner at all
  IF v_partner.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Has partner profile but not certified yet
  IF NOT COALESCE(v_partner.is_certified, false) THEN
    RETURN 'uncertified';
  END IF;

  -- Certified: check if production provider
  IF v_partner.is_production_provider THEN
    RETURN 'professional';
  ELSE
    RETURN 'amateur';
  END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_type(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_type(p_user_id uuid) TO authenticated;
