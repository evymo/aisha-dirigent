-- Policy: Users can insert their own check-ins

CREATE POLICY "Users can insert their own check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));
