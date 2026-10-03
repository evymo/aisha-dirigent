-- Function: public.is_umbrella_study
-- Arguments: p_study_id uuid
-- Description: Checks if study is umbrella study.
-- Security: SECURITY DEFINER with search_path.
-- @audit: none (read-only public study metadata)

CREATE OR REPLACE FUNCTION public.is_umbrella_study(p_study_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_umbrella boolean;
BEGIN
  SELECT is_umbrella INTO v_is_umbrella
  FROM studies
  WHERE id = p_study_id;

  RETURN COALESCE(v_is_umbrella, false);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_umbrella_study(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_umbrella_study(p_study_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_umbrella_study(p_study_id uuid) TO authenticated;
