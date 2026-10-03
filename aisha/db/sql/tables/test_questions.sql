-- Table: test_questions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS test_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.test_templates ON DELETE SET NULL,
  question text,
  question_type text DEFAULT 'multiple_choice'::text,
  options jsonb,
  correct_answer text,
  points int4 DEFAULT 1,
  question_order int4 NOT NULL,
  created_at timestamptz DEFAULT now(),
  test_type text NOT NULL DEFAULT 'qualification'::text,
  question_key text,
  option_a_key text,
  option_b_key text,
  option_c_key text,
  option_d_key text,
  is_active bool NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE test_questions ENABLE ROW LEVEL SECURITY;
