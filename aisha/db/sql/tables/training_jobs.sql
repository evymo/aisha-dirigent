-- Table: training_jobs
-- Tracks LoRA/fine-tuning training job execution lifecycle.

CREATE TABLE IF NOT EXISTS public.training_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  dataset_id uuid NOT NULL REFERENCES public.training_datasets(id),
  base_model text NOT NULL,
  adapter_type text NOT NULL DEFAULT 'lora',
  status text NOT NULL DEFAULT 'pending',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_path text,
  adapter_model_id uuid REFERENCES public.ai_model_registry(id),
  metrics jsonb DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES aisha_auth.users(id),
  PRIMARY KEY (id),
  CONSTRAINT training_jobs_status_check CHECK (
    status IN ('pending', 'exporting', 'training', 'evaluating', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT training_jobs_adapter_type_check CHECK (
    adapter_type IN ('lora', 'qlora', 'full_finetune')
  )
);

ALTER TABLE public.training_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.training_jobs IS 'Tracks LoRA/QLoRA training job execution lifecycle';
COMMENT ON COLUMN public.training_jobs.config IS 'Training hyperparams: {lora_rank, lora_alpha, learning_rate, epochs, batch_size, max_seq_length}';
COMMENT ON COLUMN public.training_jobs.metrics IS 'Training metrics: {train_loss, eval_loss, eval_score, tokens_processed, duration_seconds}';
COMMENT ON COLUMN public.training_jobs.output_path IS 'Path to trained adapter (local or remote)';
