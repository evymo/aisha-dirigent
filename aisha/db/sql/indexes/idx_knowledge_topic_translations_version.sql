-- Index: idx_knowledge_topic_translations_version

CREATE INDEX idx_knowledge_topic_translations_version ON public.knowledge_topic_translations USING btree (topic_version_id);
