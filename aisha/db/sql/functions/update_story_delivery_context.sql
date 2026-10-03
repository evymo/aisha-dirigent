-- Function: public.update_story_delivery_context
-- Arguments: p_story_id uuid, p_repo_url text DEFAULT NULL::text, p_repo_provider text DEFAULT NULL::text, p_default_branch text DEFAULT NULL::text, p_delivery_status text DEFAULT NULL::text, p_tech_stack text[] DEFAULT NULL::text[], p_risk_profile text DEFAULT NULL::text, p_domain text[] DEFAULT NULL::text[], p_build_config jsonb DEFAULT NULL::jsonb, p_env_hints jsonb DEFAULT NULL::jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_story_delivery_context(p_story_id uuid, p_repo_url text DEFAULT NULL::text, p_repo_provider text DEFAULT NULL::text, p_default_branch text DEFAULT NULL::text, p_delivery_status text DEFAULT NULL::text, p_tech_stack text[] DEFAULT NULL::text[], p_risk_profile text DEFAULT NULL::text, p_domain text[] DEFAULT NULL::text[], p_build_config jsonb DEFAULT NULL::jsonb, p_env_hints jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_count int := 0;
BEGIN
  -- Authorization: must be admin/staff or story owner
  IF NOT is_admin_or_staff() THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_stories
      WHERE id = p_story_id AND partner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff';
    END IF;
  END IF;

  -- Update partner_stories delivery columns (only non-NULL params)
  UPDATE partner_stories SET
    repo_url = COALESCE(p_repo_url, repo_url),
    repo_provider = COALESCE(p_repo_provider, repo_provider),
    default_branch = COALESCE(p_default_branch, default_branch),
    delivery_status = COALESCE(p_delivery_status, delivery_status),
    tech_stack = COALESCE(p_tech_stack, tech_stack),
    risk_profile = COALESCE(p_risk_profile, risk_profile),
    domain = COALESCE(p_domain, domain),
    updated_at = now()
  WHERE id = p_story_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Upsert story_contexts for build_config / env_hints
  IF p_build_config IS NOT NULL OR p_env_hints IS NOT NULL THEN
    INSERT INTO story_contexts (story_id, build_config, env_hints)
    VALUES (
      p_story_id,
      COALESCE(p_build_config, '{}'::jsonb),
      COALESCE(p_env_hints, '{}'::jsonb)
    )
    ON CONFLICT (story_id) DO UPDATE SET
      build_config = CASE WHEN p_build_config IS NOT NULL THEN p_build_config ELSE story_contexts.build_config END,
      env_hints = CASE WHEN p_env_hints IS NOT NULL THEN p_env_hints ELSE story_contexts.env_hints END,
      updated_at = now();
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'STORY_DELIVERY_CONTEXT_UPDATED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'fields_updated', v_updated_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'rows_updated', v_updated_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_story_delivery_context(uuid, text, text, text, text, text[][], text, text[][], jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_story_delivery_context(uuid, text, text, text, text, text[][], text, text[][], jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_story_delivery_context(uuid, text, text, text, text, text[][], text, text[][], jsonb, jsonb) TO service_role;
