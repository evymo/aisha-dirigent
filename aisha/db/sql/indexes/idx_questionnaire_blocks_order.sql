-- Index: idx_questionnaire_blocks_order
-- Table: questionnaire_blocks

CREATE INDEX idx_questionnaire_blocks_order ON public.questionnaire_blocks USING btree (questionnaire_id, display_order);
