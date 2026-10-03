-- Policy: Admins can manage knowledge posts

DROP POLICY IF EXISTS "Admins can manage knowledge posts" ON public.knowledge_posts;
CREATE POLICY "Admins can manage knowledge posts" ON public.knowledge_posts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
