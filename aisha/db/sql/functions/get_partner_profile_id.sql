-- Function: public.get_partner_profile_id
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:13+01:00

CREATE OR REPLACE FUNCTION public.get_partner_profile_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT id INTO v_partner_id
  FROM public.partner_profiles
  WHERE user_id = auth.uid();
  
  RETURN v_partner_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_profile_id() TO authenticated;
