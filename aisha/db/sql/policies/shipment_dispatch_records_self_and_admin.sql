-- Policies: shipment_dispatch_records
-- A member may read their own dispatch references; admin/staff read all.
-- Writes are service_role-only (svc-packeta via create_shipment_record, which is
-- SECURITY DEFINER and bypasses RLS) — no anon/authenticated write policy exists.

DROP POLICY IF EXISTS "Users can view own shipment dispatch records" ON public.shipment_dispatch_records;
CREATE POLICY "Users can view own shipment dispatch records" ON public.shipment_dispatch_records
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR (SELECT is_admin_or_staff((SELECT auth.uid()))));
