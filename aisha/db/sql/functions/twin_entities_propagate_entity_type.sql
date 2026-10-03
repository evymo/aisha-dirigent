-- ============================================================================
-- Source of Truth: twin_entities_propagate_entity_type (trigger funkce)
-- Popis: Změní-li dvojče druh, změní se i druh jeho vazeb (twin_external_refs
--        .entity_type je odvozená kopie). Kdyby tím vznikla dvojí potvrzená
--        vazba téhož klíče v novém druhu, změna SPADNE na unikátním indexu —
--        nahlas, ne tichým ukončením cizí vazby.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_entities_propagate_entity_type()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER: druh se čte z twin_entities bez ohledu na to, co vidí volající
-- (RLS by jinak druh schovala a vložení vazby spadlo na NOT NULL).
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.twin_external_refs
     SET entity_type = NEW.entity_type
   WHERE twin_id = NEW.id
     AND entity_type IS DISTINCT FROM NEW.entity_type;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_entities_propagate_entity_type() FROM PUBLIC, anon, authenticated;
