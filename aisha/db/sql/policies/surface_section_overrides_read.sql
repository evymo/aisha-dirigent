-- Policy: přihlášený čte zákaznické úpravy šablony navigace.
--
-- Týž důvod jako u surface_sections_read: jde o metadata sekcí, ne o obsah.
-- Merge (coalesce(override, šablona)) dělá list_surface_sections jako
-- SECURITY INVOKER, takže čtenář nevidí o sekci víc, než na co má nárok.
--
-- Zápis nemá grant: jediný zapisovatel je set_surface_section_override_admin.

DROP POLICY IF EXISTS surface_section_overrides_read ON public.surface_section_overrides;
CREATE POLICY surface_section_overrides_read ON public.surface_section_overrides
  FOR SELECT TO authenticated
  USING (true);
