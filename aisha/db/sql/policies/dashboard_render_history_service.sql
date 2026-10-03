-- Policy: dashboard_render_history_service

CREATE POLICY dashboard_render_history_service ON public.dashboard_render_history
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
