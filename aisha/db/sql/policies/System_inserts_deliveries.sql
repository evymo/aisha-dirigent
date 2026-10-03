-- Policy: System inserts deliveries

CREATE POLICY "System inserts deliveries" ON public.news_article_deliveries
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (false);
