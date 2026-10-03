-- Function: public.is_study_consultant
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:54+01:00

CREATE OR REPLACE FUNCTION public.is_study_consultant(p_study_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
  v_is_consultant BOOLEAN;
BEGIN
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();

  IF v_partner_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM study_consultants sc
    WHERE sc.study_id = p_study_id
      AND sc.partner_id = v_partner_id
      AND sc.status = 'approved'
  ) INTO v_is_consultant;

  RETURN v_is_consultant;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_study_consultant(p_study_id uuid) FROM PUBLIC;
-- No GRANT - internal/helper function
