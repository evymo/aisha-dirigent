-- Trigger: twin_external_refs_entity_type
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Lives in triggers/ (emitted AFTER functions) so the trigger function exists when it binds.
-- Šíření změny druhu z twin_entities: triggers/twin_entities_entity_type_refs.sql.
--
-- Pořadí na živé DB (heals): tabulka přidala sloupec a doplnila ho → tady
-- vznikne trigger → doplní se, co mezitím přibylo → kontrola → NOT NULL.

DROP TRIGGER IF EXISTS twin_external_refs_entity_type ON public.twin_external_refs;
CREATE TRIGGER twin_external_refs_entity_type
  BEFORE INSERT OR UPDATE OF twin_id, entity_type ON public.twin_external_refs
  FOR EACH ROW EXECUTE FUNCTION public.twin_external_refs_set_entity_type();

DO $$
DECLARE
  v_prazdne bigint;
BEGIN
  UPDATE public.twin_external_refs r
     SET entity_type = t.entity_type
    FROM public.twin_entities t
   WHERE t.id = r.twin_id
     AND r.entity_type IS DISTINCT FROM t.entity_type;
  SELECT count(*) INTO v_prazdne FROM public.twin_external_refs WHERE entity_type IS NULL;
  IF v_prazdne > 0 THEN
    -- twin_id je NOT NULL s cizím klíčem a druh dvojčete je NOT NULL, takže
    -- sem se dojít nemá. Kdyby přesto: nahlas, nic se nemaže ani nedomýšlí.
    RAISE EXCEPTION 'twin_external_refs.entity_type: % vazeb nejde doplnit z dvojčete — nic se nemaže, oprav data a spusť znovu', v_prazdne;
  END IF;
  ALTER TABLE public.twin_external_refs ALTER COLUMN entity_type SET NOT NULL;
END
$$;
