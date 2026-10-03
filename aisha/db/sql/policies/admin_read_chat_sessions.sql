-- Policy: admin_read_chat_sessions

CREATE POLICY "admin_read_chat_sessions"
  ON public.public_chat_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
    )
  );
