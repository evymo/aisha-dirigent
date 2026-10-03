-- Policy: Admins and staff can view disputes

DROP POLICY IF EXISTS "Admins and staff can view disputes" ON public.stripe_disputes;
CREATE POLICY "Admins and staff can view disputes" ON public.stripe_disputes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
