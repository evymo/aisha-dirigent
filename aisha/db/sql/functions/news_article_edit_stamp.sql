-- Function: public.news_article_edit_stamp
-- Description: Razítko stavu, který editor upravuje: novější z `updated_at`
--              článku a `updated_at` jeho konceptu. Klient ho dostane při načtení
--              a posílá zpět jako `p_expected_stamp`; když mezitím uložil někdo
--              jiný, razítko nesedí a zápis skončí 409 místo tichého přepsání
--              cizí práce (do 2026-09-24 vyhrával poslední zápis, beze slova).
-- Security: SECURITY DEFINER (čte i nezveřejněné) — autorizuje sám: admin/staff
--           nebo service_role.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.news_article_edit_stamp(p_article_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT GREATEST(a.updated_at, COALESCE(d.updated_at, a.updated_at))
    FROM public.news_articles a
    LEFT JOIN public.news_article_versions d
      ON d.article_id = a.id AND d.kind = 'draft'
    WHERE a.id = p_article_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.news_article_edit_stamp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_article_edit_stamp(uuid) TO authenticated, service_role;
