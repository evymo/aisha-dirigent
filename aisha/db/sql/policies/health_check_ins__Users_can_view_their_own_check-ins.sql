-- Policy: Users can view their own check-ins

CREATE POLICY "Users can view their own check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
