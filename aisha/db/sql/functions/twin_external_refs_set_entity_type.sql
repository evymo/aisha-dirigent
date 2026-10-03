-- ============================================================================
-- Source of Truth: twin_external_refs_set_entity_type (trigger funkce)
-- Popis: Druh entity vazby se ODVOZUJE z dvojčete, na které vazba ukazuje —
--        nikdy nepřichází od volajícího (ani ho nesmí přepsat). Je součástí
--        klíče jedinečnosti potvrzené vazby (uq_twin_external_refs_active_owner),
--        takže kdyby šel zadat ručně, šla by pojistka obejít.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_external_refs_set_entity_type()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER: druh se čte z twin_entities bez ohledu na to, co vidí volající
-- (RLS by jinak druh schovala a vložení vazby spadlo na NOT NULL).
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  SELECT t.entity_type INTO NEW.entity_type
    FROM public.twin_entities t
   WHERE t.id = NEW.twin_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_external_refs_set_entity_type() FROM PUBLIC, anon, authenticated;
