-- Trigger: trg_sync_topic_version_to_ki

CREATE TRIGGER trg_sync_topic_version_to_ki
  AFTER INSERT ON public.knowledge_topic_versions
  FOR EACH ROW
  EXECUTE FUNCTION sync_topic_version_to_knowledge_item();
