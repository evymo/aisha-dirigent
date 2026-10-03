-- Policy: drift_state_read
-- Read access pro admin/staff (dashboard widget queries).

DROP POLICY IF EXISTS drift_state_read ON public.drift_state;
CREATE POLICY drift_state_read ON public.drift_state
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
