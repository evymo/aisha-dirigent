-- Policy: Users can delete their own check-ins

CREATE POLICY "Users can delete their own check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()));
