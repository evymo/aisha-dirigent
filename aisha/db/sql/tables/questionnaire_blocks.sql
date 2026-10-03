-- Table: questionnaire_blocks
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS questionnaire_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL,
  block_id uuid NOT NULL,
  display_order int4 NOT NULL DEFAULT 0,
  is_required bool NOT NULL DEFAULT false,
  step_number int4 DEFAULT 1,
  section_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT questionnaire_blocks_questionnaire_id_block_id_key UNIQUE (questionnaire_id, block_id),
  CONSTRAINT questionnaire_blocks_block_id_fkey FOREIGN KEY (block_id) REFERENCES question_blocks(id) ON DELETE CASCADE,
  CONSTRAINT questionnaire_blocks_questionnaire_id_fkey FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE
);

ALTER TABLE questionnaire_blocks ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON questionnaire_blocks TO authenticated;
GRANT SELECT ON questionnaire_blocks TO anon;
GRANT ALL ON questionnaire_blocks TO service_role;
