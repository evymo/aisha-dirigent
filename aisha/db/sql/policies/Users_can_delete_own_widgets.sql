-- Policy: Users can delete own widgets

CREATE POLICY "Users can delete own widgets" ON public.member_dashboard_widgets
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()));
