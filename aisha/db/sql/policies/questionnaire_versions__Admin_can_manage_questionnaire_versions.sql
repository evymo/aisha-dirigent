-- Policy: Admin can manage questionnaire versions

DROP POLICY IF EXISTS "Admin can manage questionnaire versions" ON public.questionnaire_versions;
CREATE POLICY "Admin can manage questionnaire versions" ON public.questionnaire_versions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
