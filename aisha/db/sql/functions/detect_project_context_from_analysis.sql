-- Function: detect_project_context_from_analysis
-- Purpose: Accept repo analysis results and update story delivery context
-- Security: SECURITY DEFINER (admin/staff or story owner)
-- MCP tool: detect_project_context_from_analysis

CREATE OR REPLACE FUNCTION public.detect_project_context_from_analysis(
  p_story_id uuid,
  p_analysis jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tech_stack text[];
  v_domain text[];
  v_risk_profile text;
  v_repo_url text;
  v_repo_provider text;
  v_default_branch text;
  v_updated int := 0;
BEGIN
  -- Authorization: admin/staff or story owner
  IF NOT is_admin_or_staff() AND NOT public.can_manage_project_story(p_story_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_stories
      WHERE id = p_story_id AND partner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff';
    END IF;
  END IF;

  IF p_analysis IS NULL OR p_analysis = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Empty analysis provided');
  END IF;

  -- Extract fields from analysis JSON
  SELECT
    CASE WHEN p_analysis ? 'tech_stack'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_analysis->'tech_stack'))
      ELSE NULL
    END,
    CASE WHEN p_analysis ? 'domain'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_analysis->'domain'))
      ELSE NULL
    END,
    p_analysis->>'risk_profile',
    p_analysis->>'repo_url',
    p_analysis->>'repo_provider',
    p_analysis->>'default_branch'
  INTO v_tech_stack, v_domain, v_risk_profile, v_repo_url, v_repo_provider, v_default_branch;

  -- Update partner_stories with detected context
  UPDATE partner_stories SET
    tech_stack = COALESCE(v_tech_stack, tech_stack),
    domain = COALESCE(v_domain, domain),
    risk_profile = COALESCE(v_risk_profile, risk_profile),
    repo_url = COALESCE(v_repo_url, repo_url),
    repo_provider = COALESCE(v_repo_provider, repo_provider),
    default_branch = COALESCE(v_default_branch, default_branch),
    delivery_status = COALESCE(delivery_status, 'analyzing'),
    updated_at = now()
  WHERE id = p_story_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PROJECT_CONTEXT_DETECTED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'tech_stack_count', COALESCE(array_length(v_tech_stack, 1), 0),
      'domain_count', COALESCE(array_length(v_domain, 1), 0),
      'risk_profile', v_risk_profile,
      'source', COALESCE(p_analysis->>'source', 'manual')
    )
  );

  RETURN jsonb_build_object(
    'success', v_updated > 0,
    'story_id', p_story_id,
    'detected', jsonb_build_object(
      'tech_stack', COALESCE(to_jsonb(v_tech_stack), '[]'::jsonb),
      'domain', COALESCE(to_jsonb(v_domain), '[]'::jsonb),
      'risk_profile', v_risk_profile,
      'repo_url', v_repo_url
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.detect_project_context_from_analysis(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_project_context_from_analysis(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.detect_project_context_from_analysis(uuid, jsonb) IS
  'Accepts project analysis results (from MCP/n8n repo analyzer) and updates story delivery context. '
  'Used by AISHA onboarding pipeline after repo analysis.';
