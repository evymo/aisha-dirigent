-- Function: public.get_news_tags_admin
-- Description: Všechny štítky novinek pro SPRÁVU (přejmenování, sloučení, názvy):
--              i u nezveřejněných článků a v konceptech zveřejněných — veřejné
--              get_news_tags počítá jen zveřejněné, takže štítek z konceptu by
--              správkyně v seznamu neviděla.
--              article_count = článků se štítkem (živě nebo v konceptu),
--              published_count = zveřejněných článků, kde ho vidí web.
-- Security: SECURITY DEFINER; admin/staff.
-- Created: 2026-10-02 (z instance: „měla by mít možnost si další tagy přidávat sama")

CREATE OR REPLACE FUNCTION public.get_news_tags_admin()
RETURNS TABLE (tag text, article_count bigint, published_count bigint)
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
  WITH vyskyty AS (
    SELECT a.id AS clanek, u.stitek, a.is_published AS na_webu
      FROM public.news_articles a, unnest(a.tags) AS u(stitek)
    UNION
    SELECT d.article_id, u.stitek, false
      FROM public.news_article_versions d,
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(d.fields -> 'tags') = 'array' THEN d.fields -> 'tags' ELSE '[]'::jsonb END
           ) AS u(stitek)
     WHERE d.kind = 'draft'
  )
  SELECT v.stitek,
         count(DISTINCT v.clanek),
         count(DISTINCT v.clanek) FILTER (WHERE v.na_webu)
    FROM vyskyty v
   GROUP BY v.stitek
   ORDER BY count(DISTINCT v.clanek) DESC, v.stitek;
END;
$$;

REVOKE ALL ON FUNCTION public.get_news_tags_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_news_tags_admin() TO authenticated;
