-- Trigger: trg_protect_reserved_knowledge
--
-- Vyhrazené zdroje znalostí ('platform_knowledge', 'instance_knowledge') zapisuje jen seed
-- z repozitáře; koncový uživatel API je nevloží, nesmaže ani nepřepíše obsah — ani přes
-- definer RPC, které RLS obchází. Pravidla a proč: functions/fn_protect_reserved_knowledge.sql.
--
-- DROP první, aby opakované použití (baseline + \ir v heals.sql pro existující DB) bylo
-- idempotentní.
DROP TRIGGER IF EXISTS trg_protect_reserved_knowledge ON public.knowledge_items;
CREATE TRIGGER trg_protect_reserved_knowledge
  BEFORE INSERT OR UPDATE OR DELETE ON public.knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_reserved_knowledge();
