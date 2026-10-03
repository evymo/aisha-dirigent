-- Policy: Admin and staff can read article versions ON public.news_article_versions
-- Zápis jde výhradně přes SECURITY DEFINER RPC (create_news_article_version,
-- save_news_article_draft_admin, …), které autorizují samy; čtení tabulky přímo
-- (PostgREST) smí admin/staff. Poddotaz → InitPlan, jedno vyhodnocení za dotaz.

DROP POLICY IF EXISTS "Admin and staff can read article versions" ON public.news_article_versions;
CREATE POLICY "Admin and staff can read article versions" ON public.news_article_versions
  AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
