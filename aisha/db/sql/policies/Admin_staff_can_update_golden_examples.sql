-- Policy: Admin/staff can update golden examples

DROP POLICY IF EXISTS "Admin/staff can update golden examples" ON public.ai_golden_examples;
CREATE POLICY "Admin/staff can update golden examples" ON public.ai_golden_examples
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT is_admin_or_staff()));
