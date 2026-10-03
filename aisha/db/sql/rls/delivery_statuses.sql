-- RLS: delivery_statuses
-- Mirrors workflow_statuses RLS — authenticated read, admin/staff write.

ALTER TABLE public.delivery_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_read_delivery_statuses" ON public.delivery_statuses;
CREATE POLICY "authenticated_can_read_delivery_statuses"
  ON public.delivery_statuses
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_staff_can_manage_delivery_statuses" ON public.delivery_statuses;
CREATE POLICY "admin_staff_can_manage_delivery_statuses"
  ON public.delivery_statuses
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
