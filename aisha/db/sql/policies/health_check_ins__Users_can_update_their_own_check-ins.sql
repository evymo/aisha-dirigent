-- Policy: Users can update their own check-ins

CREATE POLICY "Users can update their own check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
