-- Function: public.get_web_page_admin
-- Description: Returns a single web page with canvas data for admin editing.
--   Multi-site: exposes branding_profile_id.
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-04-11
--
-- 2026-10-02: vrací navíc `edit_stamp` (web_page_edit_stamp — razítko pro
-- souběžnou kontrolu uložení) a `draft` (koncept zveřejněné stránky, je-li;
-- editor z něj hydratuje). Změna návratového typu = DROP v heals.sql (CREATE OR
-- REPLACE typ nezmění; čistá DB ho nepotřebuje). V SoT DROP být nesmí — brána
-- rls-predikat-a-indexy: DROP téže signatury na běžící DB padá na závislostech.

CREATE OR REPLACE FUNCTION public.get_web_page_admin(p_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  description_key text,
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  status text,
  sort_order integer,
  is_active boolean,
  og_image_url text,
  page_settings jsonb,
  branding_profile_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  edit_stamp timestamptz,
  draft jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    wp.id,
    wp.slug,
    wp.title_key,
    wp.description_key,
    wp.canvas_data,
    wp.canvas_html,
    wp.canvas_css,
    wp.status,
    wp.sort_order,
    wp.is_active,
    wp.og_image_url,
    wp.page_settings,
    wp.branding_profile_id,
    wp.created_at,
    wp.updated_at,
    public.web_page_edit_stamp(wp.id),
    (SELECT jsonb_build_object(
              'canvas_data',   d.canvas_data,
              'canvas_html',   d.canvas_html,
              'canvas_css',    d.canvas_css,
              'page_settings', d.page_settings,
              'updated_at',    d.updated_at)
       FROM public.web_page_versions d
      WHERE d.page_id = wp.id AND d.kind = 'draft')
  FROM web_pages wp
  WHERE wp.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_web_page_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_page_admin(uuid) TO authenticated;
