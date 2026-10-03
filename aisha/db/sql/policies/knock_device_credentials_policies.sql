-- Policies: knock_device_credentials
--
-- ⛔ ZÁMĚRNĚ SKOUPÉ. Všechny cesty k téhle tabulce vedou přes SECURITY DEFINER
-- RPC (`register_knock_device`, `admin_list_knock_devices`,
-- `admin_set_knock_device_approval`), které si autorizaci dělají samy. Přímé
-- čtení `authenticated` by nepřidalo nic užitečného a přidalo by druhou cestu
-- k témuž — tedy druhé místo, kde se dá udělat chyba.
--
-- ⛔ PROČ TU PŘESTO POLICY JE, když by „žádná policy" znamenala totéž. Prázdno
-- se nedá odlišit od zapomenutí. Vyslovená policy říká, že skoupost je
-- ROZHODNUTÍ — a kdo ji bude chtít rozšířit, uvidí u ní důvod.

DROP POLICY IF EXISTS knock_device_credentials_admin_read ON public.knock_device_credentials;
CREATE POLICY knock_device_credentials_admin_read
  ON public.knock_device_credentials
  FOR SELECT
  TO authenticated
  -- Poddotaz, ne holé volání: predikát nezávisí na řádku, takže patří do
  -- InitPlanu. Per-row by z něj udělalo tolik volání, kolik je zařízení.
  USING ((SELECT public.is_admin_or_staff()));
