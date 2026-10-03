-- Function: upsert_story_environment

CREATE OR REPLACE FUNCTION public.upsert_story_environment(p_story_id uuid, p_environment text, p_url text DEFAULT NULL::text, p_branch text DEFAULT NULL::text, p_deploy_provider text DEFAULT 'coolify'::text, p_deploy_id text DEFAULT NULL::text, p_deploy_status text DEFAULT 'pending'::text, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_env_id uuid;
BEGIN
  -- Authorization
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Only staff/admin can manage environments' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO story_environments (story_id, environment, url, branch, deploy_provider, deploy_id, deploy_status, config)
  VALUES (p_story_id, p_environment, p_url, p_branch, p_deploy_provider, p_deploy_id, p_deploy_status, p_config)
  ON CONFLICT (story_id, environment) DO UPDATE SET
    url = COALESCE(EXCLUDED.url, story_environments.url),
    branch = COALESCE(EXCLUDED.branch, story_environments.branch),
    deploy_provider = COALESCE(EXCLUDED.deploy_provider, story_environments.deploy_provider),
    deploy_id = COALESCE(EXCLUDED.deploy_id, story_environments.deploy_id),
    deploy_status = COALESCE(EXCLUDED.deploy_status, story_environments.deploy_status),
    config = COALESCE(EXCLUDED.config, story_environments.config),
    last_deployed_at = CASE WHEN EXCLUDED.deploy_status = 'deployed' THEN now() ELSE story_environments.last_deployed_at END
  RETURNING id INTO v_env_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ENVIRONMENT_UPSERT',
    jsonb_build_object(
      'area', 'delivery',
      'severity', 'info',
      'story_id', p_story_id,
      'environment', p_environment,
      'deploy_status', p_deploy_status
    )
  );

  RETURN v_env_id;
END;
$function$;

REVOKE ALL ON FUNCTION upsert_story_environment(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_story_environment(uuid,text,text,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_story_environment(uuid,text,text,text,text,text,text,jsonb) TO service_role;
