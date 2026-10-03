-- Index: idx_knowledge_items_story
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_items_story ON public.knowledge_items USING btree (story_id) WHERE (story_id IS NOT NULL);
