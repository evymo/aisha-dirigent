-- Function: public.get_current_partner_id
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:45+01:00

CREATE OR REPLACE FUNCTION public.get_current_partner_id()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
BEGIN
  SELECT id INTO v_partner_id
  FROM public.partner_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
  
  RETURN v_partner_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_current_partner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_partner_id() TO authenticated;
