-- Policy: Admin/staff can manage topic translations

DROP POLICY IF EXISTS "Admin/staff can manage topic translations" ON public.knowledge_topic_translations;
CREATE POLICY "Admin/staff can manage topic translations" ON public.knowledge_topic_translations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
