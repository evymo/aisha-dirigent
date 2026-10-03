-- Policy: Anyone can read published news

CREATE POLICY "Anyone can read published news" ON public.news_articles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_published = true));
