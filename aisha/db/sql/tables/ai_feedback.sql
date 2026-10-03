-- =============================================================================
-- Table: ai_feedback
-- Purpose: Collect developer/user feedback on AI responses for training data
-- Part of: AISHA Learning Engine (ALE) — Phase 1 (L1 Data Collection)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  trace_event_id uuid,
  conversation_id uuid REFERENCES public.chat_conversations ON DELETE SET NULL,
  message_id uuid REFERENCES public.chat_messages ON DELETE SET NULL,
  user_id uuid NOT NULL,
  org_id uuid,
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,
  run_id uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  rating smallint NOT NULL,
  correction_text text,
  feedback_category text DEFAULT 'general'::text NOT NULL,
  domain_tags text[] DEFAULT '{}'::text[] NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_processed boolean DEFAULT false NOT NULL,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT ai_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT ai_feedback_rating_range CHECK (rating >= -1 AND rating <= 5),
  CONSTRAINT ai_feedback_category_valid CHECK (
    feedback_category IN ('general', 'accuracy', 'style', 'completeness', 'safety', 'compliance')
  ),
  CONSTRAINT ai_feedback_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

-- Policies: see supabase/sql/policies/Users_can_insert_own_feedback.sql etc.
-- Indexes: see supabase/sql/indexes/ai_feedback_indexes.sql

COMMENT ON TABLE public.ai_feedback IS 'Developer/user feedback on AI responses for ALE training data pipeline';
COMMENT ON COLUMN public.ai_feedback.rating IS 'Feedback rating: -1 (harmful), 0 (bad), 1–5 (quality scale)';
COMMENT ON COLUMN public.ai_feedback.correction_text IS 'User-provided correction of AI response (used for DPO preference pairs)';
COMMENT ON COLUMN public.ai_feedback.feedback_category IS 'Category: general, accuracy, style, completeness, safety, compliance';
COMMENT ON COLUMN public.ai_feedback.domain_tags IS 'Domain tags for routing to appropriate training datasets';
COMMENT ON COLUMN public.ai_feedback.story_id IS 'Direct story context — resolved from ai_runs.story_id via run_id';
COMMENT ON COLUMN public.ai_feedback.run_id IS 'AI run that produced this response — from content_metadata.aisha_run_id';
