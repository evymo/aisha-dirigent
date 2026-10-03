-- =============================================================================
-- Table: training_examples
-- Purpose: Individual training examples (instruction/response pairs, DPO pairs)
-- Part of: AISHA Learning Engine (ALE) — Phase 1 (L2 Data Curation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.training_examples (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  dataset_id uuid NOT NULL,
  example_type text DEFAULT 'instruction'::text NOT NULL,
  instruction text NOT NULL,
  input text DEFAULT ''::text NOT NULL,
  output text NOT NULL,
  chosen text,
  rejected text,
  system_prompt text,
  domain_tags text[] DEFAULT '{}'::text[] NOT NULL,
  source_id uuid,
  source_type text,
  quality_score numeric(4,3),
  is_validated boolean DEFAULT false NOT NULL,
  validated_by uuid,
  validated_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT training_examples_pkey PRIMARY KEY (id),
  CONSTRAINT training_examples_type_valid CHECK (
    example_type IN ('instruction', 'preference_pair', 'chat_turn', 'completion')
  ),
  CONSTRAINT training_examples_preference_pair_check CHECK (
    example_type != 'preference_pair' OR (chosen IS NOT NULL AND rejected IS NOT NULL)
  ),
  CONSTRAINT training_examples_dataset_id_fkey
    FOREIGN KEY (dataset_id) REFERENCES public.training_datasets(id) ON DELETE CASCADE,
  CONSTRAINT training_examples_validated_by_fkey
    FOREIGN KEY (validated_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;

-- Policies: see supabase/sql/policies/Admin_staff_can_manage_training_examples.sql
-- Indexes: see supabase/sql/indexes/training_examples_indexes.sql

COMMENT ON TABLE public.training_examples IS 'Individual training examples for ALE fine-tuning (SFT instruction pairs, DPO preference pairs)';
COMMENT ON COLUMN public.training_examples.chosen IS 'Preferred response (DPO only) — from user correction or A/B test winner';
COMMENT ON COLUMN public.training_examples.rejected IS 'Rejected response (DPO only) — original AI response that was corrected';
COMMENT ON COLUMN public.training_examples.source_id IS 'ID of origin record (ai_feedback.id, knowledge_items.id, etc.)';
COMMENT ON COLUMN public.training_examples.source_type IS 'Origin table: ai_feedback, knowledge_items, expert_rules, ragnarok_doc';
