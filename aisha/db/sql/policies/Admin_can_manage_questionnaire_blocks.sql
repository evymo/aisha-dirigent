-- Policy: Admin can manage questionnaire blocks

DROP POLICY IF EXISTS "Admin can manage questionnaire blocks" ON public.questionnaire_blocks;
CREATE POLICY "Admin can manage questionnaire blocks" ON public.questionnaire_blocks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
