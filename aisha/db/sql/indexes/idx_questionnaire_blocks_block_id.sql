-- Index: idx_questionnaire_blocks_block_id
-- Table: questionnaire_blocks

CREATE INDEX idx_questionnaire_blocks_block_id ON public.questionnaire_blocks USING btree (block_id);
