-- =============================================================================
-- Function: get_branding_profile — Resolved branding with fallback chain
-- =============================================================================
-- Returns published branding profile for a given partner.
-- If partner has no published profile, falls back to global (partner_id IS NULL).
-- Public access (SECURITY DEFINER) — branding must be visible for login pages.

CREATE OR REPLACE FUNCTION public.get_branding_profile(
  p_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner_row jsonb;
  v_global_row jsonb;
  v_result jsonb;
BEGIN
  -- Try partner-specific published profile
  IF p_partner_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', bp.id,
      'partner_id', bp.partner_id,
      'status', bp.status,
      'color_primary', bp.color_primary,
      'color_secondary', bp.color_secondary,
      'color_accent', bp.color_accent,
      'color_background', bp.color_background,
      'color_foreground', bp.color_foreground,
      'color_muted', bp.color_muted,
      'color_surface', bp.color_surface,
      'color_destructive', bp.color_destructive,
      'dark_color_primary', bp.dark_color_primary,
      'dark_color_background', bp.dark_color_background,
      'dark_color_foreground', bp.dark_color_foreground,
      'dark_color_surface', bp.dark_color_surface,
      'dark_color_muted', bp.dark_color_muted,
      'font_family_brand', bp.font_family_brand,
      'font_family_body', bp.font_family_body,
      'font_family_code', bp.font_family_code,
      'font_faces', bp.font_faces,
      'logo_path', bp.logo_path,
      'logo_dark_path', bp.logo_dark_path,
      'favicon_path', bp.favicon_path,
      'login_logo_path', bp.login_logo_path,
      'operator_name', bp.operator_name,
      'operator_email', bp.operator_email,
      'operator_phone', bp.operator_phone,
      'operator_address', bp.operator_address,
      'operator_url', bp.operator_url,
      'email_header_bg', bp.email_header_bg,
      'email_footer_text', bp.email_footer_text,
      'login_background_color', bp.login_background_color,
      'login_card_bg', bp.login_card_bg,
      'login_accent_color', bp.login_accent_color,
      'profile_version', bp.profile_version,
      'updated_at', bp.updated_at,
      'published_at', bp.published_at
    ) INTO v_partner_row
    FROM branding_profiles bp
    WHERE bp.partner_id = p_partner_id
      AND bp.status = 'published'
    ORDER BY bp.published_at DESC NULLS LAST, bp.id
    LIMIT 1;
  END IF;

  -- Always load global fallback
  SELECT jsonb_build_object(
    'id', bp.id,
    'partner_id', bp.partner_id,
    'status', bp.status,
    'color_primary', bp.color_primary,
    'color_secondary', bp.color_secondary,
    'color_accent', bp.color_accent,
    'color_background', bp.color_background,
    'color_foreground', bp.color_foreground,
    'color_muted', bp.color_muted,
    'color_surface', bp.color_surface,
    'color_destructive', bp.color_destructive,
    'dark_color_primary', bp.dark_color_primary,
    'dark_color_background', bp.dark_color_background,
    'dark_color_foreground', bp.dark_color_foreground,
    'dark_color_surface', bp.dark_color_surface,
    'dark_color_muted', bp.dark_color_muted,
    'font_family_brand', bp.font_family_brand,
    'font_family_body', bp.font_family_body,
    'font_family_code', bp.font_family_code,
    'font_faces', bp.font_faces,
    'logo_path', bp.logo_path,
    'logo_dark_path', bp.logo_dark_path,
    'favicon_path', bp.favicon_path,
    'login_logo_path', bp.login_logo_path,
    'operator_name', bp.operator_name,
    'operator_email', bp.operator_email,
    'operator_phone', bp.operator_phone,
    'operator_address', bp.operator_address,
    'operator_url', bp.operator_url,
    'email_header_bg', bp.email_header_bg,
    'email_footer_text', bp.email_footer_text,
    'login_background_color', bp.login_background_color,
    'login_card_bg', bp.login_card_bg,
    'login_accent_color', bp.login_accent_color,
    'profile_version', bp.profile_version,
    'updated_at', bp.updated_at,
    'published_at', bp.published_at
  ) INTO v_global_row
  FROM branding_profiles bp
  WHERE bp.partner_id IS NULL
    AND bp.status = 'published'
  -- The unique index only covers partner brands (partner_id IS NOT NULL), so N
  -- published platform brands are allowed to coexist. Without an explicit order a
  -- SELECT INTO picked whichever the planner happened to return — the "default"
  -- brand was decided by chance. Newest published wins; id breaks ties.
  ORDER BY bp.published_at DESC NULLS LAST, bp.id
  LIMIT 1;

  -- Merge: partner values override global; NULL partner fields fall through to global
  IF v_partner_row IS NOT NULL AND v_global_row IS NOT NULL THEN
    -- Strip null values from partner row before merge so global acts as fallback
    v_result := v_global_row;
    -- Overlay non-null partner values
    SELECT jsonb_object_agg(key, value) INTO v_partner_row
    FROM jsonb_each(v_partner_row)
    WHERE value != 'null'::jsonb;
    v_result := v_result || COALESCE(v_partner_row, '{}'::jsonb);
  ELSIF v_partner_row IS NOT NULL THEN
    v_result := v_partner_row;
  ELSIF v_global_row IS NOT NULL THEN
    v_result := v_global_row;
  ELSE
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_result := v_result || jsonb_build_object(
    'resolved_for', COALESCE(p_partner_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

  RETURN jsonb_build_object('status', 'ok', 'profile', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.get_branding_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branding_profile(uuid) TO public;

COMMENT ON FUNCTION public.get_branding_profile(uuid) IS
  'Returns resolved branding profile (partner override merged over global fallback). Public access for login pages.';
