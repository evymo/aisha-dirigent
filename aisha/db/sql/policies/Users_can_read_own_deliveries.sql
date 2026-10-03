-- Policy: Users can read own deliveries

CREATE POLICY "Users can read own deliveries" ON public.news_article_deliveries
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
