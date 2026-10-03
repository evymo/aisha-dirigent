-- Policy: Admins can manage knowledge post translations

DROP POLICY IF EXISTS "Admins can manage knowledge post translations" ON public.knowledge_post_translations;
CREATE POLICY "Admins can manage knowledge post translations" ON public.knowledge_post_translations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
