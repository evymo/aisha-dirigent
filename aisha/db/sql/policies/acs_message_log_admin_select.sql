-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_message_log_admin_select ON public.acs_message_log;
CREATE POLICY acs_message_log_admin_select ON public.acs_message_log
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
