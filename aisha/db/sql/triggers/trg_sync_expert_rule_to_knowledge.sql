-- Trigger: trg_sync_expert_rule_to_knowledge

-- Mirror expert_rules into the RAG knowledge corpus on CREATE as well as edit.
-- The original AFTER UPDATE-only event meant rules created via INSERT (the
-- create_expert_rule_audited flow AND the demo seed) NEVER reached knowledge_items,
-- so prod chat could not retrieve any authoritative expert rule until it happened to
-- be edited later (seeded rules: 27 published, 0 mirrored). AFTER INSERT OR UPDATE
-- mirrors on creation; sync_expert_rule_to_knowledge_item() is an idempotent upsert
-- (ON CONFLICT (source_type, source_id)), so re-fires on later edits are safe.
CREATE TRIGGER trg_sync_expert_rule_to_knowledge
  AFTER INSERT OR UPDATE ON public.expert_rules
  FOR EACH ROW
  EXECUTE FUNCTION sync_expert_rule_to_knowledge_item();
