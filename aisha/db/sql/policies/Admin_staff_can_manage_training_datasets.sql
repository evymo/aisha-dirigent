-- Policy: Admin staff can manage training datasets
-- Table: training_datasets

DROP POLICY IF EXISTS "Admin staff can manage training datasets" ON public.training_datasets;
CREATE POLICY "Admin staff can manage training datasets"
  ON public.training_datasets FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
