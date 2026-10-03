-- Function: public.link_story_to_installation_repo
-- Links a partner_story to a GitHub App installation and repository.
-- Updates repo_url, repo_provider, default_branch on the story.
-- @security: admin/staff only (SECURITY INVOKER)

CREATE OR REPLACE FUNCTION public.link_story_to_installation_repo(
  p_story_id uuid,
  p_installation_id bigint,
  p_repo_full_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_repo public.github_app_repositories;
  v_install public.github_app_installations;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  SELECT * INTO v_install
  FROM public.github_app_installations
  WHERE installation_id = p_installation_id
    AND suspended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installation % not found or suspended', p_installation_id;
  END IF;

  SELECT * INTO v_repo
  FROM public.github_app_repositories
  WHERE installation_id = p_installation_id
    AND repo_full_name = p_repo_full_name
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repository % not found in installation %', p_repo_full_name, p_installation_id;
  END IF;

  UPDATE public.partner_stories
  SET github_installation_id = p_installation_id,
      repo_url = 'https://github.com/' || p_repo_full_name,
      repo_provider = 'github',
      default_branch = COALESCE(v_repo.default_branch, 'main'),
      updated_at = now()
  WHERE id = p_story_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'STORY_REPO_LINKED',
    jsonb_build_object(
      'story_id', p_story_id,
      'installation_id', p_installation_id,
      'repo_full_name', p_repo_full_name,
      'area', 'github_app',
      'severity', 'info'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'story_id', p_story_id,
    'installation_id', p_installation_id,
    'repo_full_name', p_repo_full_name,
    'partner_id', v_install.partner_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_story_to_installation_repo(uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_story_to_installation_repo(uuid, bigint, text) TO authenticated;
