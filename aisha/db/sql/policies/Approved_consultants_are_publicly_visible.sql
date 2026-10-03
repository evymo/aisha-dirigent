-- Policy: Approved consultants are publicly visible

CREATE POLICY "Approved consultants are publicly visible" ON public.study_consultants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((status = 'approved'::consultant_status_enum));
