-- Function: public.get_registration_studies
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:47+01:00

CREATE OR REPLACE FUNCTION public.get_registration_studies(p_study_id uuid)
 RETURNS TABLE(study_id uuid, study_name text, is_umbrella boolean, is_target boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_study_id UUID;
BEGIN
  -- Get parent study if exists
  SELECT s.parent_study_id INTO v_parent_study_id
  FROM studies s WHERE s.id = p_study_id;
  
  RETURN QUERY
  -- Return parent umbrella first (if exists)
  SELECT 
    s.id AS study_id,
    s.name AS study_name,
    s.is_umbrella,
    false AS is_target
  FROM studies s
  WHERE s.id = v_parent_study_id
    AND v_parent_study_id IS NOT NULL
  
  UNION ALL
  
  -- Return target study
  SELECT
    s.id AS study_id,
    s.name AS study_name,
    s.is_umbrella,
    true AS is_target
  FROM studies s
  WHERE s.id = p_study_id

  ORDER BY is_target;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_registration_studies(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_studies(p_study_id uuid) TO authenticated;
