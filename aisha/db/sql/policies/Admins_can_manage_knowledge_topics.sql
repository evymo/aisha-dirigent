-- Policy: Admins can manage knowledge topics

DROP POLICY IF EXISTS "Admins can manage knowledge topics" ON public.knowledge_topics;
CREATE POLICY "Admins can manage knowledge topics" ON public.knowledge_topics
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
