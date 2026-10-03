-- Index: uq_story_labels_polymorphic
-- Auto-extracted (back-port reconciliation)

CREATE UNIQUE INDEX uq_story_labels_polymorphic ON public.story_labels USING btree (resource_type, resource_id, label) WHERE (resource_id IS NOT NULL);
