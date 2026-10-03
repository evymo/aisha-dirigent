-- Trigger: trg_knowledge_source_concept_id (Brick5)
--
-- Sets source_concept_id = COALESCE(source_id, id) on every INSERT and whenever
-- source_id changes. Separate SoT file (not inlined in the table — the table SoT must
-- not reference functions, per the cold-start inline-trigger ordering invariant).
DROP TRIGGER IF EXISTS trg_knowledge_source_concept_id ON public.knowledge_items;
CREATE TRIGGER trg_knowledge_source_concept_id
  BEFORE INSERT OR UPDATE OF source_id ON public.knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.set_knowledge_source_concept_id();
