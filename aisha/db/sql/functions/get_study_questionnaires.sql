-- Function: public.get_study_questionnaires
-- Description: Returns study questionnaires with unified translation keys.
-- Security: SECURITY INVOKER.

CREATE OR REPLACE FUNCTION public.get_study_questionnaires(p_study_id uuid)
 RETURNS TABLE(id uuid, description_key text, display_order integer, is_required boolean, study_id uuid, title_key text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sq.id,
    sq.description_key,
    sq.display_order,
    sq.is_required,
    sq.study_id,
    sq.title_key
  FROM study_questionnaires sq
  WHERE sq.study_id = p_study_id
  ORDER BY sq.display_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_questionnaires(p_study_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_study_questionnaires(p_study_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_study_questionnaires(p_study_id uuid) TO authenticated;
