-- Policy: Admin/staff can delete golden examples

DROP POLICY IF EXISTS "Admin/staff can delete golden examples" ON public.ai_golden_examples;
CREATE POLICY "Admin/staff can delete golden examples" ON public.ai_golden_examples
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT is_admin_or_staff()));
