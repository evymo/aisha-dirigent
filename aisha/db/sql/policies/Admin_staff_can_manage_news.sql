-- Policy: Admin/staff can manage news

DROP POLICY IF EXISTS "Admin/staff can manage news" ON public.news_articles;
CREATE POLICY "Admin/staff can manage news" ON public.news_articles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
