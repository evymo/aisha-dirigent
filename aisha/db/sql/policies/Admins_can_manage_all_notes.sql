-- Policy: Admins can manage all notes

DROP POLICY IF EXISTS "Admins can manage all notes" ON public.partner_appointment_notes;
CREATE POLICY "Admins can manage all notes" ON public.partner_appointment_notes
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
