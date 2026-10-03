-- Policy: Authenticated can view visible knowledge posts

CREATE POLICY "Authenticated can view visible knowledge posts" ON public.knowledge_posts
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (status = 'visible'::text)));
