-- =============================================================================
-- Function: get_branding_for_hostname — hostname → mapped branding profile
-- =============================================================================
-- Resolves a request hostname (e.g. window.location.hostname from the SPA)
-- to its mapped branding profile via the branding_hostname_mapping table.
-- The mapping row is the authority — the profile resolves by id regardless of
-- its draft/published status (see the WHERE clause below for the multi-brand
-- rationale).
--
-- Use case: multi-brand single-instance deployments. A single SPA bundle
-- serves multiple hostnames (e.g. umbrella.example.com → umbrella brand,
-- therapy.example.com → therapy-first brand). The frontend calls this RPC during
-- bootstrap to pick the correct theme + landing route before first paint.
--
-- Return shape (jsonb):
--   {
--     "status": "ok",
--     "brand_variant": "umbrella" | "therapy-first",
--     "primary_route":   text | null,   -- default landing for this hostname
--     "secondary_route": text | null,   -- alternate route the brand exposes
--     "profile": { ...branding_profiles row... }
--   }
--
-- Returns NULL when:
--   - Hostname has no row in branding_hostname_mapping, OR
--   - The mapping references a branding_profile id that no longer exists.
-- Caller falls back to the global default brand via get_branding_profile().
--
-- Caller is ALWAYS anon (this fires before login). Hence SECURITY DEFINER
-- + EXECUTE grant to anon — branding is intentionally public.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_branding_for_hostname(p_hostname text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand_id uuid;
  v_mapping RECORD;
  v_profile jsonb;
BEGIN
  -- Značka podle hostname: JEDEN resolver pro všechny čtyři čtečky (tahle +
  -- get_web_page_by_slug, get_published_web_page_index, get_published_web_partials).
  -- Mapování je autorita, status profilu ne — viz resolve_brand_for_hostname.
  v_brand_id := public.resolve_brand_for_hostname(p_hostname);
  IF v_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Nápovědy rout téhož řádku mapování (hostname je PK; táž normalizace
  -- jako v resolveru, jinak by se id a nápovědy mohly vzít z různých řádků).
  SELECT brand_variant, primary_route, secondary_route
    INTO v_mapping
  FROM public.branding_hostname_mapping
  WHERE lower(hostname) = lower(trim(p_hostname))
  LIMIT 1;

  -- Build the same profile shape as get_branding_profile produces, but
  -- selected by branding_profile_id directly (not partner_id).
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
  )
    INTO v_profile
  FROM public.branding_profiles bp
  WHERE bp.id = v_brand_id
  -- Resolve by mapping id REGARDLESS of bp.status. The branding_hostname_mapping
  -- row is the explicit operator decision "serve this brand on this hostname" —
  -- it is the gate, not the profile's draft/published label.
  --
  -- Required by the multi-brand-per-instance model: only ONE platform-level
  -- brand (partner_id IS NULL) may be 'published', because get_branding_profile
  -- (the default resolver) would otherwise pick non-deterministically between
  -- two published NULL-partner rows. The SECONDARY brand is therefore kept
  -- 'draft' ON PURPOSE and reached purely via its hostname mapping.
  --
  -- MĚŘENO: filtrování na status='published' tady tiše zahodilo KAŽDOU
  -- sekundární značku — hostname na ni namapovaný se vyhodnotil na NULL
  -- a spadl zpátky na zastřešující značku. Vada se neprojevila chybou,
  -- jen "špatnou značkou". Viz migraci
  -- 20260601120000_branding_hostname_resolve_by_id pro plné odůvodnění.
  LIMIT 1;

  IF v_profile IS NULL THEN
    -- Mapping references a profile id that no longer exists — caller falls back
    -- to the global default brand via get_branding_profile().
    RETURN NULL;
  END IF;

  -- Compose the result: profile object + hostname-mapping metadata at top level.
  RETURN jsonb_build_object(
    'status', 'ok',
    'brand_variant', v_mapping.brand_variant,
    'primary_route', v_mapping.primary_route,
    'secondary_route', v_mapping.secondary_route,
    'profile', v_profile
  );
END;
$$;

COMMENT ON FUNCTION public.get_branding_for_hostname(text) IS
  'Resolve hostname → mapped branding profile via branding_hostname_mapping. '
  'Resolves by mapping id regardless of profile status (the mapping is the '
  'authority; secondary multi-brand profiles are kept draft so the default '
  'resolver stays deterministic). Returns NULL only when the hostname is '
  'unmapped or the mapped profile id is gone (caller falls back to global '
  'default). SECURITY DEFINER + anon grant — branding is public (pre-login).';

GRANT EXECUTE ON FUNCTION public.get_branding_for_hostname(text)
  TO anon, authenticated, service_role;

-- Upstream 2026-05-26: revoke PUBLIC grant (per-role grants below)
REVOKE ALL ON FUNCTION public.get_branding_for_hostname(text) FROM PUBLIC;
