-- Policy: Consultants can view adjustments they authorized

CREATE POLICY "Consultants can view adjustments they authorized" ON public.distribution_adjustments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((authorized_by = auth.uid()));
