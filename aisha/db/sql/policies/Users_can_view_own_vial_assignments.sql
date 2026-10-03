-- Policy: Users can view own vial assignments

CREATE POLICY "Users can view own vial assignments" ON public.vial_assignments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
