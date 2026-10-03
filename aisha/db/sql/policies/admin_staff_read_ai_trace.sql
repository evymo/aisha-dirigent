-- Policy: admin_staff_read_ai_trace

DROP POLICY IF EXISTS "admin_staff_read_ai_trace" ON public.ai_trace_events;
CREATE POLICY "admin_staff_read_ai_trace" ON public.ai_trace_events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
