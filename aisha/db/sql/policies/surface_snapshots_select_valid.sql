-- Policy: authenticated čte jen platné (neexpirované) snímky. Klient si podpis
-- VŽDY ověřuje sám pinovaným public klíčem — RLS je první, ne jediná vrstva.

DROP POLICY IF EXISTS surface_snapshots_select_valid ON public.surface_snapshots;
CREATE POLICY surface_snapshots_select_valid ON public.surface_snapshots
  FOR SELECT TO authenticated
  USING (expires_at > now());
