-- Policy: Admins can manage knowledge topic versions

DROP POLICY IF EXISTS "Admins can manage knowledge topic versions" ON public.knowledge_topic_versions;
CREATE POLICY "Admins can manage knowledge topic versions" ON public.knowledge_topic_versions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
