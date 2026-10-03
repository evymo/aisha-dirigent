-- Function: public.get_web_pages_admin
-- Description: Returns all active web pages for admin list. Multi-site: exposes
--   branding_profile_id and accepts an optional brand filter (NULL = all sites).
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-04-11

-- ⛔ DROP TU NENÍ ZÁMĚRNĚ, i když návratový typ přibráním `page_settings`
-- ZMĚNIL a `CREATE OR REPLACE` to neumí. Nové databáze žádnou starou funkci
-- k odstranění nemají, takže by tu DROP jen ležel — a na běžící databázi je
-- DROP fatální, pokud na funkci visí policy nebo view (u is_admin_or_staff
-- to bylo 253 policies a padl celý migrate). Odstranění staré signatury proto
-- patří tam, kde konvergují UŽ BĚŽÍCÍ instance: `DROP + \ir` v heals.sql.

CREATE OR REPLACE FUNCTION public.get_web_pages_admin(p_branding_profile_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slug text,
  title_key text,
  description_key text,
  status text,
  sort_order integer,
  is_active boolean,
  og_image_url text,
  branding_profile_id uuid,
  -- ⛔ ÚTRŽEK VYPADÁ JAKO STRÁNKA, ale nemá adresu. `page_settings.role`
  -- je jediné, čím je administrace rozezná — bez toho by autor viděl `nav`
  -- ve výpisu stránek a marně zkoušel navštívit /nav/.
  page_settings jsonb,
  created_at timestamptz,
  updated_at timestamptz
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
    wp.status,
    wp.sort_order,
    wp.is_active,
    wp.og_image_url,
    wp.branding_profile_id,
    wp.page_settings,
    wp.created_at,
    wp.updated_at
  FROM web_pages wp
  WHERE wp.is_active = true
    AND (
      p_branding_profile_id IS NULL
      OR wp.branding_profile_id IS NOT DISTINCT FROM p_branding_profile_id
    )
  ORDER BY wp.sort_order ASC, wp.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_web_pages_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_pages_admin(uuid) TO authenticated;
