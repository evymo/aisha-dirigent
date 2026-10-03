-- Source of Truth: fn_record_rerank_event_audited (Step 6)
-- Migration: aisha/db/migrations/20260518260000_rerank_stage.sql

CREATE OR REPLACE FUNCTION public.fn_record_rerank_event_audited(
  p_run_id           uuid,
  p_provider_slug    text,
  p_model_id         text,
  p_input_count      integer,
  p_output_count     integer,
  p_latency_ms       integer,
  p_metadata         jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'retrieval.rerank_completed',
    jsonb_build_object('run_id', p_run_id, 'provider_slug', p_provider_slug,
      'model_id', p_model_id, 'input_count', p_input_count,
      'output_count', p_output_count, 'latency_ms', p_latency_ms,
      'extra', COALESCE(p_metadata, '{}'::jsonb)));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_rerank_event_audited(uuid, text, text, integer, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_rerank_event_audited(uuid, text, text, integer, integer, integer, jsonb) TO service_role;
