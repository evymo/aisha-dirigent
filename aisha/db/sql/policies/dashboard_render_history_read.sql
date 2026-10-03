-- Policy: dashboard_render_history_read

DROP POLICY IF EXISTS dashboard_render_history_read ON public.dashboard_render_history;
CREATE POLICY dashboard_render_history_read ON public.dashboard_render_history
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
