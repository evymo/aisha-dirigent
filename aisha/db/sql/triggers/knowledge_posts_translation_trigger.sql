-- Trigger: knowledge_posts_translation_trigger

CREATE TRIGGER knowledge_posts_translation_trigger
  AFTER INSERT ON public.knowledge_posts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_knowledge_post_translation();
