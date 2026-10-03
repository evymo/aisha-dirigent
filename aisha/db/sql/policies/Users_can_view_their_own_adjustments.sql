-- Policy: Users can view their own adjustments

CREATE POLICY "Users can view their own adjustments" ON public.distribution_adjustments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((member_token = auth.uid()));
