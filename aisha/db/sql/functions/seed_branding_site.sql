-- Function: public.seed_branding_site
-- =============================================================================
-- Idempotent upsert of a platform-level brand ("site") plus its inbound
-- hostname → brand mapping, returning branding_profiles.id so the caller can
-- attach web_pages to it (web_pages.branding_profile_id).
--
-- Identity / idempotency: keyed on HOSTNAME. branding_profiles has no slug, so
-- a stable re-seed must find the brand THROUGH its existing hostname mapping
-- (branding_hostname_mapping.hostname is the PK). First seed creates a new
-- published platform brand (partner_id IS NULL) + its mapping; re-seed updates
-- the same rows in place — never duplicates.
--
-- Used by the boot-time web-artifact ingest (svc-web-artifact /seed-default,
-- service_role) to materialise a multi-domain design manifest's sites[] into
-- the live branding_profiles + branding_hostname_mapping rows that
-- get_branding_for_hostname() / get_web_page_by_slug(slug, hostname) resolve.
--
-- Security: SECURITY DEFINER. Callable by service_role (boot seed) OR admin/staff
-- (admin page-builder). Visual palette args are optional — the marketing canvas
-- is self-styled via --sc-* tokens; the profile mainly carries identity + routing.

CREATE OR REPLACE FUNCTION public.seed_branding_site(
  p_hostname text,
  p_brand_variant text,
  p_operator_name text DEFAULT NULL,
  p_landing_path text DEFAULT NULL,
  p_color_primary text DEFAULT NULL,
  p_color_background text DEFAULT NULL,
  p_color_surface text DEFAULT NULL,
  p_color_foreground text DEFAULT NULL,
  p_dark_color_background text DEFAULT NULL,
  p_dark_color_surface text DEFAULT NULL,
  p_dark_color_foreground text DEFAULT NULL,
  p_font_family_brand text DEFAULT NULL,
  p_operator_email text DEFAULT NULL,
  p_operator_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean :=
    (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  v_host text := lower(trim(COALESCE(p_hostname, '')));
  v_variant text := lower(trim(COALESCE(p_brand_variant, '')));
  v_profile_id uuid;
  v_action public.journal_action_type;
BEGIN
  -- Authorization: boot-time service_role OR an admin/staff session.
  IF NOT (v_is_service OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized: service_role or admin/staff required';
  END IF;

  IF v_host = '' THEN
    RAISE EXCEPTION 'seed_branding_site: hostname is required';
  END IF;
  -- brand_variant must satisfy branding_hostname_mapping.brand_variant CHECK.
  IF v_variant !~ '^[a-z][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'seed_branding_site: invalid brand_variant %', p_brand_variant;
  END IF;

  -- Idempotent identity: reuse the brand already mapped to this hostname.
  SELECT branding_profile_id INTO v_profile_id
  FROM public.branding_hostname_mapping
  WHERE lower(hostname) = v_host;

  IF v_profile_id IS NULL THEN
    v_action := 'create';
    INSERT INTO public.branding_profiles (
      partner_id, status,
      color_primary, color_background, color_surface, color_foreground,
      dark_color_background, dark_color_surface, dark_color_foreground,
      font_family_brand,
      operator_name, operator_email, operator_url,
      published_at
    ) VALUES (
      NULL, 'published',
      COALESCE(p_color_primary, '23 100% 55%'),
      COALESCE(p_color_background, '210 20% 98%'),
      COALESCE(p_color_surface, '0 0% 100%'),
      COALESCE(p_color_foreground, '0 0% 10%'),
      p_dark_color_background, p_dark_color_surface, p_dark_color_foreground,
      COALESCE(p_font_family_brand, 'Nunito Sans, sans-serif'),
      COALESCE(p_operator_name, 'Platform'),
      COALESCE(p_operator_email, 'support@platform.com'),
      p_operator_url,
      now()
    )
    RETURNING id INTO v_profile_id;
  ELSE
    v_action := 'update';
    UPDATE public.branding_profiles SET
      status = 'published',
      color_primary = COALESCE(p_color_primary, color_primary),
      color_background = COALESCE(p_color_background, color_background),
      color_surface = COALESCE(p_color_surface, color_surface),
      color_foreground = COALESCE(p_color_foreground, color_foreground),
      dark_color_background = COALESCE(p_dark_color_background, dark_color_background),
      dark_color_surface = COALESCE(p_dark_color_surface, dark_color_surface),
      dark_color_foreground = COALESCE(p_dark_color_foreground, dark_color_foreground),
      font_family_brand = COALESCE(p_font_family_brand, font_family_brand),
      operator_name = COALESCE(p_operator_name, operator_name),
      operator_email = COALESCE(p_operator_email, operator_email),
      operator_url = COALESCE(p_operator_url, operator_url),
      profile_version = profile_version + 1,
      updated_at = now()
    WHERE id = v_profile_id;
  END IF;

  -- Bind the hostname to the brand (case-insensitive PK match on re-seed).
  INSERT INTO public.branding_hostname_mapping (hostname, branding_profile_id, brand_variant, primary_route)
  VALUES (v_host, v_profile_id, v_variant, NULLIF(trim(COALESCE(p_landing_path, '')), ''))
  ON CONFLICT (hostname) DO UPDATE SET
    branding_profile_id = EXCLUDED.branding_profile_id,
    brand_variant = EXCLUDED.brand_variant,
    primary_route = EXCLUDED.primary_route,
    updated_at = now();

  PERFORM public.write_audit_journal(
    p_action_type := v_action,
    p_area := 'content'::public.journal_area,
    p_entity_id := v_profile_id::text,
    p_entity_type := 'branding_site',
    p_new_values := jsonb_build_object('hostname', v_host, 'brand_variant', v_variant, 'operator_name', p_operator_name),
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Seeded branding site ' || v_host,
    p_tags := ARRAY['seed', 'branding', 'web', v_action::text],
    p_user_id := auth.uid()
  );

  RETURN v_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_branding_site(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_branding_site(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_branding_site(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.seed_branding_site(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'Idempotent (hostname-keyed) upsert of a platform-level brand + its '
  'branding_hostname_mapping; returns branding_profiles.id. Service_role (boot '
  'seed) or admin/staff. Feeds get_web_page_by_slug(slug, hostname) multi-site routing.';
