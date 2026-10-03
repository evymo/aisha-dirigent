-- Function: public.get_study_informed_consent_special_provisions
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:36+01:00

CREATE OR REPLACE FUNCTION public.get_study_informed_consent_special_provisions(p_study_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_provisions text;
BEGIN
  SELECT informed_consent_special_provisions INTO v_provisions
  FROM studies
  WHERE id = p_study_id;
  
  RETURN v_provisions;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_informed_consent_special_provisions(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_informed_consent_special_provisions(p_study_id uuid) TO authenticated;
