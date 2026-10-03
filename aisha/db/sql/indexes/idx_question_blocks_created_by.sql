-- Index: idx_question_blocks_created_by
-- Table: question_blocks

CREATE INDEX IF NOT EXISTS idx_question_blocks_created_by ON public.question_blocks(created_by);
