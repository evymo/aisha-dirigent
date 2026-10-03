-- Policy: Admins can manage knowledge topic links

DROP POLICY IF EXISTS "Admins can manage knowledge topic links" ON public.knowledge_topic_links;
CREATE POLICY "Admins can manage knowledge topic links" ON public.knowledge_topic_links
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
