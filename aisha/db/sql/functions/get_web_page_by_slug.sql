-- Function: public.get_web_page_by_slug
-- Description: Returns a single published page for public rendering (anon access).
--   Multi-site: p_hostname resolves → brand via branding_hostname_mapping and
--   prefers the brand page over the global fallback. p_hostname DEFAULTs NULL so
--   a caller may omit it entirely (global page) — a single function serves both
--   the one-arg (global) and two-arg (brand-scoped) call forms, so there is no
--   overload ambiguity and no required-param mismatch for the one-arg callers.
-- Security: SECURITY DEFINER, anon + authenticated
-- Created: 2026-04-11

CREATE OR REPLACE FUNCTION public.get_web_page_by_slug(p_slug text, p_hostname text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  description_key text,
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  og_image_url text,
  page_settings jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  -- Značka podle hostname: sdílený resolve_brand_for_hostname — mapování je
  -- autorita, status profilu ne (viz komentář v té funkci, 2026-09-19).
  v_brand_id := public.resolve_brand_for_hostname(p_hostname);

  RETURN QUERY
  SELECT
    wp.id,
    wp.slug,
    wp.title_key,
    wp.description_key,
    wp.canvas_data,
    wp.canvas_html,
    wp.canvas_css,
    wp.og_image_url,
    wp.page_settings
  FROM web_pages wp
  WHERE wp.slug = p_slug
    AND wp.status = 'published'
    AND wp.is_active = true
    -- ⛔ ÚTRŽEK NENÍ STRÁNKA. Hlavička a patička žijí v `web_pages` se
    -- `page_settings->>'role' = 'partial'`, aby je šlo editovat týmž editorem.
    -- Bez tohohle filtru by se servírovaly jako samostatné adresy (/nav/)
    -- a generátor by jim vyráběl vlastní soubory — tedy hlavička bez stránky.
    AND coalesce(wp.page_settings->>'role', '') <> 'partial'
    AND (
      wp.branding_profile_id = v_brand_id
      OR wp.branding_profile_id IS NULL
    )
  -- Prefer the brand-specific row over the global fallback.
  ORDER BY (wp.branding_profile_id IS NOT NULL) DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_web_page_by_slug(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_page_by_slug(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_web_page_by_slug(text, text) TO authenticated;
-- service_role: boot-time /seed-default's per-page idempotency check resolves
-- the (slug, hostname) brand page as service_role before deciding to re-seed.
GRANT EXECUTE ON FUNCTION public.get_web_page_by_slug(text, text) TO service_role;

-- No separate one-arg overload: p_hostname DEFAULT NULL lets the single function
-- serve the global (one-arg) call form directly. A distinct get_web_page_by_slug(text)
-- would make a one-arg call ambiguous, so it is deliberately not defined.
