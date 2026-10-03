-- Table: message_user_feedback

CREATE TABLE IF NOT EXISTS public.message_user_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ai_run_id uuid NOT NULL,
  user_id uuid,
  rating smallint NOT NULL,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  audit_journal_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_user_feedback_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 0, 1]))),
  PRIMARY KEY (id),
  CONSTRAINT message_user_feedback_ai_run_id_user_id_key UNIQUE (ai_run_id, user_id),
  CONSTRAINT message_user_feedback_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  CONSTRAINT message_user_feedback_audit_journal_id_fkey FOREIGN KEY (audit_journal_id) REFERENCES public.audit_journal(id) ON DELETE SET NULL,
  CONSTRAINT message_user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.message_user_feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.message_user_feedback IS 'Step 2: per-message thumbs feedback from end users. Feeds back into rag_eval golden set + Step 5 critic loop tuning.';
