-- Function: public.get_news_article_versions
-- Description: Historie článku (max 50, nejnovější první). Koncept ('draft')
--              se nevypisuje — není verze, je to rozdělaná práce; editor ho
--              dostává v `get_news_article_admin`.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-09-24 (zrcadlí get_web_page_versions)

CREATE OR REPLACE FUNCTION public.get_news_article_versions(p_article_id uuid)
RETURNS TABLE (
  id uuid,
  version_number integer,
  kind text,
  label text,
  created_by uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT v.id, v.version_number, v.kind, v.label, v.created_by, v.created_at
  FROM public.news_article_versions v
  WHERE v.article_id = p_article_id AND v.kind <> 'draft'
  ORDER BY v.version_number DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_news_article_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_article_versions(uuid) TO authenticated;
