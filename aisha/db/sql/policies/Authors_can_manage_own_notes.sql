-- Policy: Authors can manage own notes

CREATE POLICY "Authors can manage own notes" ON public.partner_appointment_notes
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = author_id));
