-- Policy: rollback_history_read

DROP POLICY IF EXISTS rollback_history_read ON public.rollback_history;
CREATE POLICY rollback_history_read ON public.rollback_history
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
