-- =============================================================================
-- Function: set_branding_profile_admin — Admin upsert for branding profiles
-- =============================================================================
-- Creates or updates a branding profile (draft or published).
-- Admin-only with audit journal logging.
-- Publishing sets published_at and increments profile_version.
--
-- Multi-brand-aware: callers may pass `p_profile_id` to target a specific
-- brand row by primary key (required when the same partner_id slot —
-- typically `partner_id IS NULL` for platform-level brands — holds more
-- than one published row). When `p_profile_id` is omitted, the function
-- falls back to the legacy per-partner upsert behaviour.

CREATE OR REPLACE FUNCTION public.set_branding_profile_admin(
  p_color_accent text DEFAULT NULL,
  p_color_background text DEFAULT NULL,
  p_color_destructive text DEFAULT NULL,
  p_color_foreground text DEFAULT NULL,
  p_color_muted text DEFAULT NULL,
  p_color_primary text DEFAULT NULL,
  p_color_secondary text DEFAULT NULL,
  p_color_surface text DEFAULT NULL,
  p_dark_color_background text DEFAULT NULL,
  p_dark_color_foreground text DEFAULT NULL,
  p_dark_color_muted text DEFAULT NULL,
  p_dark_color_primary text DEFAULT NULL,
  p_dark_color_surface text DEFAULT NULL,
  p_email_footer_text text DEFAULT NULL,
  p_email_header_bg text DEFAULT NULL,
  p_favicon_path text DEFAULT NULL,
  p_font_family_body text DEFAULT NULL,
  p_font_family_brand text DEFAULT NULL,
  p_font_family_code text DEFAULT NULL,
  p_login_accent_color text DEFAULT NULL,
  p_login_background_color text DEFAULT NULL,
  p_login_card_bg text DEFAULT NULL,
  p_login_logo_path text DEFAULT NULL,
  p_logo_dark_path text DEFAULT NULL,
  p_logo_path text DEFAULT NULL,
  p_operator_address text DEFAULT NULL,
  p_operator_email text DEFAULT NULL,
  p_operator_name text DEFAULT NULL,
  p_operator_phone text DEFAULT NULL,
  p_operator_url text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_profile_id uuid DEFAULT NULL,
  p_publish boolean DEFAULT false,
  p_font_faces jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_new_status text;
  v_version integer;
BEGIN
  -- Authorization: admin only
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user_id AND role IN ('admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  v_new_status := CASE WHEN p_publish THEN 'published' ELSE 'draft' END;

  -- Existing-row discovery: prefer p_profile_id (multi-brand caller),
  -- fall back to partner-id slot (legacy caller).
  IF p_profile_id IS NOT NULL THEN
    SELECT id INTO v_profile_id
    FROM branding_profiles
    WHERE id = p_profile_id;
  ELSE
    SELECT id INTO v_profile_id
    FROM branding_profiles
    WHERE COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_partner_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND status = 'published'
    LIMIT 1;
  END IF;

  -- Publishing transitions the existing published partner slot to draft
  -- before promoting the target — preserves the "one published per partner"
  -- invariant. For platform-level multi-brand (partner_id IS NULL),
  -- callers MUST pass p_profile_id to disambiguate; otherwise the
  -- partner-id slot lookup would match the first published platform brand
  -- arbitrarily.
  IF p_publish AND p_partner_id IS NOT NULL THEN
    UPDATE branding_profiles
    SET status = 'draft', updated_at = now(), updated_by = v_user_id
    WHERE partner_id = p_partner_id
      AND status = 'published'
      AND (v_profile_id IS NULL OR id <> v_profile_id);
  END IF;

  IF v_profile_id IS NULL THEN
    INSERT INTO branding_profiles (
      partner_id, status,
      color_primary, color_secondary, color_accent,
      color_background, color_foreground, color_muted,
      color_surface, color_destructive,
      dark_color_primary, dark_color_background,
      dark_color_foreground, dark_color_surface, dark_color_muted,
      font_family_brand, font_family_body, font_family_code, font_faces,
      logo_path, logo_dark_path, favicon_path, login_logo_path,
      operator_name, operator_email, operator_phone, operator_address, operator_url,
      email_header_bg, email_footer_text,
      login_background_color, login_card_bg, login_accent_color,
      updated_by,
      published_at
    ) VALUES (
      p_partner_id, v_new_status,
      COALESCE(p_color_primary, '23 100% 55%'),
      COALESCE(p_color_secondary, '210 16% 95%'),
      COALESCE(p_color_accent, '22 100% 88%'),
      COALESCE(p_color_background, '210 20% 98%'),
      COALESCE(p_color_foreground, '0 0% 10%'),
      COALESCE(p_color_muted, '220 9% 46%'),
      COALESCE(p_color_surface, '0 0% 100%'),
      COALESCE(p_color_destructive, '0 85% 66%'),
      p_dark_color_primary,
      p_dark_color_background,
      p_dark_color_foreground,
      p_dark_color_surface,
      p_dark_color_muted,
      COALESCE(p_font_family_brand, 'Nunito Sans, sans-serif'),
      COALESCE(p_font_family_body, 'Nunito Sans, sans-serif'),
      COALESCE(p_font_family_code, 'JetBrains Mono, monospace'),
      p_font_faces,
      p_logo_path, p_logo_dark_path, p_favicon_path,
      p_login_logo_path,
      COALESCE(p_operator_name, 'Platform'),
      COALESCE(p_operator_email, 'support@platform.com'),
      p_operator_phone, p_operator_address, p_operator_url,
      p_email_header_bg, p_email_footer_text,
      p_login_background_color, p_login_card_bg, p_login_accent_color,
      v_user_id,
      CASE WHEN p_publish THEN now() ELSE NULL END
    )
    RETURNING id, profile_version INTO v_profile_id, v_version;
  ELSE
    UPDATE branding_profiles
    SET
      status = v_new_status,
      color_primary = COALESCE(p_color_primary, color_primary),
      color_secondary = COALESCE(p_color_secondary, color_secondary),
      color_accent = COALESCE(p_color_accent, color_accent),
      color_background = COALESCE(p_color_background, color_background),
      color_foreground = COALESCE(p_color_foreground, color_foreground),
      color_muted = COALESCE(p_color_muted, color_muted),
      color_surface = COALESCE(p_color_surface, color_surface),
      color_destructive = COALESCE(p_color_destructive, color_destructive),
      dark_color_primary = COALESCE(p_dark_color_primary, dark_color_primary),
      dark_color_background = COALESCE(p_dark_color_background, dark_color_background),
      dark_color_foreground = COALESCE(p_dark_color_foreground, dark_color_foreground),
      dark_color_surface = COALESCE(p_dark_color_surface, dark_color_surface),
      dark_color_muted = COALESCE(p_dark_color_muted, dark_color_muted),
      font_family_brand = COALESCE(p_font_family_brand, font_family_brand),
      font_family_body = COALESCE(p_font_family_body, font_family_body),
      font_family_code = COALESCE(p_font_family_code, font_family_code),
      font_faces = COALESCE(p_font_faces, font_faces),
      logo_path = COALESCE(p_logo_path, logo_path),
      logo_dark_path = COALESCE(p_logo_dark_path, logo_dark_path),
      favicon_path = COALESCE(p_favicon_path, favicon_path),
      login_logo_path = COALESCE(p_login_logo_path, login_logo_path),
      operator_name = COALESCE(p_operator_name, operator_name),
      operator_email = COALESCE(p_operator_email, operator_email),
      operator_phone = COALESCE(p_operator_phone, operator_phone),
      operator_address = COALESCE(p_operator_address, operator_address),
      operator_url = COALESCE(p_operator_url, operator_url),
      email_header_bg = COALESCE(p_email_header_bg, email_header_bg),
      email_footer_text = COALESCE(p_email_footer_text, email_footer_text),
      login_background_color = COALESCE(p_login_background_color, login_background_color),
      login_card_bg = COALESCE(p_login_card_bg, login_card_bg),
      login_accent_color = COALESCE(p_login_accent_color, login_accent_color),
      profile_version = profile_version + 1,
      updated_at = now(),
      updated_by = v_user_id,
      published_at = CASE WHEN p_publish THEN now() ELSE published_at END
    WHERE id = v_profile_id
    RETURNING profile_version INTO v_version;
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'BRANDING_PROFILE_UPSERT',
    jsonb_build_object(
      'area', 'admin',
      'severity', 'info',
      'entity_type', 'branding_profile',
      'entity_id', v_profile_id,
      'partner_id', p_partner_id,
      'profile_id', p_profile_id,
      'publish', p_publish,
      'version', v_version
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'profile_id', v_profile_id,
    'profile_version', v_version,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_branding_profile_admin(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, boolean, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_branding_profile_admin(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, boolean, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.set_branding_profile_admin(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, boolean, jsonb
) IS
  'Admin-only: upsert branding profile with draft/publish workflow and audit '
  'logging. Pass p_profile_id to target a specific brand by id (multi-brand '
  'platforms); omit it for legacy per-partner upsert.';
