-- Policy: Admin staff can manage training examples
-- Table: training_examples

DROP POLICY IF EXISTS "Admin staff can manage training examples" ON public.training_examples;
CREATE POLICY "Admin staff can manage training examples"
  ON public.training_examples FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
