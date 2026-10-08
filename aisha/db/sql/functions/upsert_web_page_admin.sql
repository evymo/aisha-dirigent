-- Function: public.upsert_web_page_admin
-- Description: Creates or updates web page metadata. Requires admin role.
--   Multi-site: accepts branding_profile_id (NULL = global / unchanged).
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-04-11

CREATE OR REPLACE FUNCTION public.upsert_web_page_admin(
  p_id uuid DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_title_key text DEFAULT NULL,
  p_description_key text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_og_image_url text DEFAULT NULL,
  p_branding_profile_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  -- Boot-time web-artifact ingest (svc-web-artifact /seed-default) calls this as
  -- service_role with no auth.uid() (sub-less system runner) — admit it, same as
  -- the rest of the seed chain (apply_web_artifact_to_page allows the seed story
  -- participant; seed_branding_site admits service_role). Admin/staff UI path
  -- (page editor) is unchanged.
  v_is_service boolean := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
BEGIN
  IF NOT (v_is_service OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT web_pages.id INTO v_id
    FROM web_pages
    WHERE web_pages.id = p_id;
  ELSIF p_slug IS NOT NULL THEN
    SELECT web_pages.id INTO v_id
    FROM web_pages
    WHERE web_pages.slug = p_slug
      AND web_pages.branding_profile_id IS NOT DISTINCT FROM p_branding_profile_id
    LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE web_pages SET
      slug = COALESCE(p_slug, web_pages.slug),
      title_key = COALESCE(p_title_key, web_pages.title_key),
      description_key = COALESCE(p_description_key, web_pages.description_key),
      status = COALESCE(p_status, web_pages.status),
      sort_order = COALESCE(p_sort_order, web_pages.sort_order),
      og_image_url = COALESCE(p_og_image_url, web_pages.og_image_url),
      branding_profile_id = COALESCE(p_branding_profile_id, web_pages.branding_profile_id),
      updated_at = now()
    WHERE web_pages.id = v_id
    RETURNING web_pages.id INTO v_id;

    PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'web_page',
      p_new_values := jsonb_build_object('slug', p_slug, 'status', p_status, 'branding_profile_id', p_branding_profile_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Updated web page metadata',
      p_tags := ARRAY['admin', 'content', 'web_page', 'update'],
      p_user_id := auth.uid()
    );
  ELSE
    v_id := COALESCE(p_id, gen_random_uuid());

    INSERT INTO web_pages (id, slug, title_key, description_key, status, sort_order, og_image_url, branding_profile_id)
    VALUES (
      v_id,
      COALESCE(p_slug, 'new-page-' || substring(v_id::text from 1 for 8)),
      COALESCE(p_title_key, 'web.pages.' || COALESCE(p_slug, v_id::text) || '.title'),
      p_description_key,
      COALESCE(p_status, 'draft'),
      COALESCE(p_sort_order, 0),
      p_og_image_url,
      p_branding_profile_id
    );

    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'web_page',
      p_new_values := jsonb_build_object('slug', p_slug, 'title_key', p_title_key, 'branding_profile_id', p_branding_profile_id),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Created web page',
      p_tags := ARRAY['admin', 'content', 'web_page', 'create'],
      p_user_id := auth.uid()
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_web_page_admin(uuid, text, text, text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_web_page_admin(uuid, text, text, text, text, integer, text, uuid) TO authenticated, service_role;
