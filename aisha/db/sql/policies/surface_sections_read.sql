-- Policy: přihlášený čte ŠABLONU navigace.
--
-- Záměrně bez zúžení: tahle tabulka je jen METADATA sekcí (klíč jména, ikona,
-- skupina, pořadí). KDO NA CO smí rozhoduje jinde a beze změny — `audience`
-- vyhodnocuje list_surface_sections (SECURITY INVOKER) přes surface_audience_allows
-- a obsah sekce dál ořezává RLS nad surface_layouts. Filtrovat publikum ještě
-- tady by tentýž test provedlo dvakrát a rozešlo by se to při první změně.
--
-- Zápis nemá grant vůbec: šablonu píše deploy (service_role), úpravy admin RPC.

DROP POLICY IF EXISTS surface_sections_read ON public.surface_sections;
CREATE POLICY surface_sections_read ON public.surface_sections
  FOR SELECT TO authenticated
  USING (true);
