-- Policy: authenticated čte jen aktivní bloky (default deny jinak).
-- TODO(Sprint 3.7): zpřísnit USING o namespace ACL (default-deny per namespace).

DROP POLICY IF EXISTS surface_blocks_select_active ON public.surface_blocks;
CREATE POLICY surface_blocks_select_active ON public.surface_blocks
  FOR SELECT TO authenticated
  USING (is_active = true);
