-- Policy: admin_read_chat_history

CREATE POLICY "admin_read_chat_history"
  ON public.public_chat_channel_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
    )
  );
