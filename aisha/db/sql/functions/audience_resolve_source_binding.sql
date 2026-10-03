-- Function: public.audience_resolve_source_binding
-- Description: Generic source-connection resolver over the story federation spine.
--   Replaces the broker's hardcoded SOURCE_PG_URL env with a per-source lookup:
--   a federated source IS a story (partner_stories), materialized on an instance
--   (story_instances), whose connection endpoints live in instance_endpoint_bindings
--   (endpoint_role + endpoint_url + auth_secret_ref). This is what makes live-read
--   generalize to N sources / N forks — each downstream fork registers its own
--   source story + binding; nothing fork-specific is hardcoded upstream.
--
--   Returns the endpoint + credential REFERENCE (never the secret itself — the
--   broker resolves auth_secret_ref against its own secret store), the declared
--   data_sensitivity, and whether the source is APPROVED. A caller MUST refuse to
--   read an unapproved source: this is the tie between approve_source (governance)
--   and the live read (which #572 left fully decoupled).
--
-- Security: SECURITY DEFINER, search_path pinned. Operator (admin/staff) OR trusted
--   service only, via the NULL-safe is_service_role() so the deny-guard is total.
--   The `audience_` prefix auto-inherits audience_autorevoke_public_execute (revokes
--   PUBLIC/anon EXECUTE) and the audience_audit_grants I1-I6 regression gate.

CREATE OR REPLACE FUNCTION public.audience_resolve_source_binding(
  p_story_id uuid,
  p_endpoint_role text DEFAULT 'source_pg_readonly'
)
  RETURNS TABLE (
    instance_id       uuid,
    endpoint_url      text,
    auth_method       text,
    auth_secret_ref   text,
    data_sensitivity  text,
    is_approved       boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_instance public.story_instances%ROWTYPE;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Resolve the story's active materialization (origin preferred).
  SELECT si.* INTO v_instance
  FROM public.story_instances si
  WHERE si.story_id = p_story_id
    AND si.status = 'active'
  ORDER BY si.is_origin DESC, si.updated_at DESC
  LIMIT 1;

  IF v_instance.id IS NULL THEN
    RAISE EXCEPTION 'No active instance materializes story %', p_story_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Classification + approval live on the instance metadata (source-onboarding
  -- lifecycle, transitioned by audience_admin_approve_source). Fail-closed
  -- defaults: unclassified => 'restricted', unapproved => false.
  RETURN QUERY
  SELECT
    b.instance_id,
    b.endpoint_url,
    b.auth_method,
    b.auth_secret_ref,
    COALESCE(v_instance.metadata ->> 'data_sensitivity', 'restricted'),
    COALESCE((v_instance.metadata ->> 'source_approved')::boolean, false)
  FROM public.instance_endpoint_bindings b
  WHERE b.instance_id = v_instance.id
    AND b.endpoint_role = p_endpoint_role
    AND b.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.audience_resolve_source_binding(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_resolve_source_binding(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.audience_resolve_source_binding(uuid, text) IS
  'Generic source-connection resolver over the story federation spine (story_instances '
  '+ instance_endpoint_bindings). Replaces the hardcoded SOURCE_PG_URL env so live-read '
  'generalises to N sources/forks. Returns endpoint + credential REFERENCE (not the secret) '
  '+ data_sensitivity + is_approved; callers must refuse unapproved sources. Admin/service only.';
