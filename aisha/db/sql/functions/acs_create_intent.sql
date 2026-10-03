-- Function: acs_create_intent
CREATE OR REPLACE FUNCTION acs_create_intent(
  p_intent_id      text,
  p_canonical      jsonb,
  p_content_sha256 text,
  p_source_class   text,
  p_created_by     text,
  p_ai_run_id      uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'acs: service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO acs_intents (intent_id, canonical, content_sha256, source_class, created_by, ai_run_id)
  VALUES (p_intent_id, p_canonical, p_content_sha256, p_source_class, p_created_by, p_ai_run_id);
  RETURN p_intent_id;
EXCEPTION WHEN unique_violation THEN
  -- Same id twice is legal ONLY for identical content (idempotent replay).
  IF EXISTS (SELECT 1 FROM acs_intents WHERE intent_id = p_intent_id AND content_sha256 = p_content_sha256) THEN
    RETURN p_intent_id;
  END IF;
  RAISE EXCEPTION 'acs_create_intent: intent % exists with different content (immutability violation)', p_intent_id;
END $$;

REVOKE ALL ON FUNCTION acs_create_intent(text, jsonb, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_create_intent(text, jsonb, text, text, text, uuid) TO service_role;
