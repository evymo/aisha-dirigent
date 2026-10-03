-- Policy: Admin/staff can read golden examples

DROP POLICY IF EXISTS "Admin/staff can read golden examples" ON public.ai_golden_examples;
CREATE POLICY "Admin/staff can read golden examples" ON public.ai_golden_examples
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
