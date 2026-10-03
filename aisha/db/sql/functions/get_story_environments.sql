-- Function: get_story_environments

CREATE OR REPLACE FUNCTION public.get_story_environments(p_story_id uuid)
 RETURNS TABLE(id uuid, environment text, url text, branch text, deploy_provider text, deploy_id text, deploy_status text, last_deployed_at timestamptz, config jsonb, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: participant or staff
  IF NOT EXISTS (
    SELECT 1 FROM story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = auth.uid()
  ) AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    se.id, se.environment, se.url, se.branch,
    se.deploy_provider, se.deploy_id, se.deploy_status,
    se.last_deployed_at, se.config, se.created_at
  FROM story_environments se
  WHERE se.story_id = p_story_id
  ORDER BY
    CASE se.environment
      WHEN 'production' THEN 1
      WHEN 'staging' THEN 2
      WHEN 'preview' THEN 3
    END;
END;
$function$;

REVOKE ALL ON FUNCTION get_story_environments(p_story_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_story_environments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_story_environments(uuid) TO service_role;
