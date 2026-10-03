-- Policy: coolify_app_slots_read
-- Read access pro admin/staff (RLS gate na get_active_slots přes is_admin_or_staff).

DROP POLICY IF EXISTS coolify_app_slots_read ON public.coolify_app_slots;
CREATE POLICY coolify_app_slots_read ON public.coolify_app_slots
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
