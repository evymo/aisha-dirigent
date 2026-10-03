-- Function: public.get_study_contributions
-- Arguments: p_study_id uuid
-- Description: Returns public study contributions. Public crowdfunding data.
-- Security: SECURITY DEFINER - public study contributions.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_study_contributions(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, user_id uuid, contribution_type text, amount numeric, description text, is_anonymous boolean, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    CASE WHEN sc.is_anonymous THEN NULL ELSE sc.user_id END,
    sc.contribution_type::text,
    sc.amount,
    sc.description,
    sc.is_anonymous,
    sc.created_at
  FROM study_contributions sc
  WHERE sc.study_id = p_study_id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions (PUBLIC: contributions pro crowdfunding jsou veřejné)
REVOKE ALL ON FUNCTION public.get_study_contributions(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_contributions(p_study_id uuid) TO public;
