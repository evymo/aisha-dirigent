-- Function: public.resolve_story_from_repo
-- Looks up partner_story by repo full name (e.g. 'org/repo').
-- First tries partner_stories.repo_url ILIKE match, then github_app_repositories join.
-- @security: service_role + authenticated

CREATE OR REPLACE FUNCTION public.resolve_story_from_repo(
  p_repo_full_name text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'story_id', ps.id,
    'partner_id', ps.partner_id,
    'installation_id', ps.github_installation_id,
    'delivery_status', ps.delivery_status,
    'title', ps.title
  ) INTO v_result
  FROM partner_stories ps
  WHERE ps.repo_url ILIKE '%' || p_repo_full_name
    AND ps.delivery_status NOT IN ('archived', 'cancelled')
  ORDER BY ps.last_activity_at DESC
  LIMIT 1;

  IF v_result IS NULL THEN
    SELECT jsonb_build_object(
      'story_id', ps.id,
      'partner_id', ps.partner_id,
      'installation_id', ps.github_installation_id,
      'delivery_status', ps.delivery_status,
      'title', ps.title
    ) INTO v_result
    FROM github_app_repositories gar
    JOIN github_app_installations gai ON gai.installation_id = gar.installation_id
    JOIN partner_stories ps ON ps.github_installation_id = gar.installation_id
    WHERE gar.repo_full_name = p_repo_full_name
      AND gar.is_active = true
      AND ps.delivery_status NOT IN ('archived', 'cancelled')
    ORDER BY ps.last_activity_at DESC
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_story_from_repo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_story_from_repo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_story_from_repo(text) TO authenticated;
