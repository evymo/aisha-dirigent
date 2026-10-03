-- Policy: Authors can view own knowledge posts

CREATE POLICY "Authors can view own knowledge posts" ON public.knowledge_posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = author_user_id));
