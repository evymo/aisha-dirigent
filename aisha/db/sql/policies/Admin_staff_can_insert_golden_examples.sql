-- Policy: Admin/staff can insert golden examples

DROP POLICY IF EXISTS "Admin/staff can insert golden examples" ON public.ai_golden_examples;
CREATE POLICY "Admin/staff can insert golden examples" ON public.ai_golden_examples
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
