-- =============================================================================
-- Table: training_datasets
-- Purpose: Track collections of training data for fine-tuning
-- Part of: AISHA Learning Engine (ALE) — Phase 1 (L2 Data Curation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.training_datasets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  name text NOT NULL,
  description text,
  source_type text NOT NULL,
  format text DEFAULT 'instruction'::text NOT NULL,
  domain_tags text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  record_count integer DEFAULT 0 NOT NULL,
  validated_count integer DEFAULT 0 NOT NULL,
  quality_score_avg numeric(4,3),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT training_datasets_pkey PRIMARY KEY (id),
  CONSTRAINT training_datasets_source_type_valid CHECK (
    source_type IN ('feedback', 'kb_extraction', 'wiki_ingestion', 'manual', 'golden_example', 'preference_pair')
  ),
  CONSTRAINT training_datasets_format_valid CHECK (
    format IN ('instruction', 'preference_pair', 'chat', 'completion')
  ),
  CONSTRAINT training_datasets_status_valid CHECK (
    status IN ('draft', 'curating', 'validated', 'training', 'archived')
  ),
  CONSTRAINT training_datasets_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.training_datasets ENABLE ROW LEVEL SECURITY;

-- Policies: see supabase/sql/policies/Admin_staff_can_manage_training_datasets.sql
-- Indexes: see supabase/sql/indexes/training_datasets_indexes.sql

COMMENT ON TABLE public.training_datasets IS 'Collections of training data for ALE fine-tuning jobs';
COMMENT ON COLUMN public.training_datasets.source_type IS 'Origin: feedback, kb_extraction, wiki_ingestion, manual, golden_example, preference_pair';
COMMENT ON COLUMN public.training_datasets.format IS 'Data format: instruction (SFT), preference_pair (DPO), chat, completion';
