-- Policy: Staff can insert transitions via RPC

DROP POLICY IF EXISTS "Staff can insert transitions via RPC" ON public.delivery_transitions;
CREATE POLICY "Staff can insert transitions via RPC" ON public.delivery_transitions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
