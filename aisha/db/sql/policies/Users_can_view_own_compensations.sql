-- Policy: Users can view own compensations

CREATE POLICY "Users can view own compensations" ON public.placebo_compensations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
