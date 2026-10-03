-- Policy: Users can view their own assessments

CREATE POLICY "Users can view their own assessments" ON public.operational_assessments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
