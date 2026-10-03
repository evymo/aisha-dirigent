-- Policy: admin_manage_chat_channels

CREATE POLICY "admin_manage_chat_channels"
  ON public.public_chat_channels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
    )
  );
