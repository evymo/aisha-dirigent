-- Function: set_knowledge_source_concept_id (Brick5 cross-lingual dedup)
--
-- source_concept_id = source-node identity. All locale variants of one source node
-- share a source_id, so they group under the same concept; items without a source_id
-- (ad-hoc/manual) are singletons (concept = own id). Retrieval (mcp_search_knowledge
-- v2/v3) dedups by source_concept_id so cross-lingual near-duplicates collapse to one
-- winning variant. Behaviour-neutral until retrieval reads it.
CREATE OR REPLACE FUNCTION public.set_knowledge_source_concept_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.source_concept_id := COALESCE(NEW.source_id, NEW.id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_knowledge_source_concept_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_knowledge_source_concept_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_knowledge_source_concept_id() TO service_role;
