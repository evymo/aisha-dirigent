-- Trigger: twin_entities_entity_type_refs
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Lives in triggers/ (emitted AFTER functions) so the trigger function exists when it binds.
--
-- Změna druhu dvojčete se propíše do twin_external_refs.entity_type (kopie,
-- která je součástí klíče jedinečnosti vazby). Kdyby tím vznikla dvojí
-- potvrzená vazba v rámci druhu, spadne to NAHLAS na uq_twin_external_refs_active_owner.

DROP TRIGGER IF EXISTS twin_entities_entity_type_refs ON public.twin_entities;
CREATE TRIGGER twin_entities_entity_type_refs
  AFTER UPDATE OF entity_type ON public.twin_entities
  FOR EACH ROW EXECUTE FUNCTION public.twin_entities_propagate_entity_type();
