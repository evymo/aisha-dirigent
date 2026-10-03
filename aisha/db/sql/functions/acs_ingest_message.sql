-- Function: acs_ingest_message
CREATE OR REPLACE FUNCTION acs_ingest_message(p_message jsonb, p_received_by text DEFAULT 'db')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_env        jsonb;
  v_schema_ref text;
  v_mode       text;
  v_code       text := NULL;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'acs: service role required' USING ERRCODE = '42501';
  END IF;

  v_env := p_message -> 'envelope';
  IF v_env IS NULL OR p_message -> 'payload' IS NULL THEN
    v_code := 'envelope_invalid';
  ELSE
    v_schema_ref := v_env ->> 'schema';
    IF v_schema_ref IS NULL OR v_schema_ref !~ '^[a-z0-9_.-]+@[0-9]+\.[0-9]+$' THEN
      v_code := 'envelope_invalid';
    ELSIF (v_env ->> 'message_id') IS NULL OR (v_env ->> 'message_id') !~ '^[0-9A-HJKMNP-TV-Z]{26}$' THEN
      v_code := 'envelope_invalid';
    ELSIF (v_env ->> 'intent_id') IS NULL OR (v_env ->> 'intent_id') !~ '^int_[0-9A-HJKMNP-TV-Z]{26}$' THEN
      v_code := 'envelope_invalid';
    ELSIF NOT EXISTS (SELECT 1 FROM acs_message_schemas s WHERE s.schema_ref = v_schema_ref) THEN
      v_code := 'unknown_schema';
    ELSIF NOT EXISTS (SELECT 1 FROM acs_intents i WHERE i.intent_id = v_env ->> 'intent_id') THEN
      v_code := 'envelope_invalid';  -- lineage anchor must exist (R3)
    ELSIF EXISTS (SELECT 1 FROM acs_message_log l WHERE l.message_id = v_env ->> 'message_id') THEN
      v_code := 'duplicate_message';
    END IF;
  END IF;

  IF v_code IS NULL THEN
    INSERT INTO acs_message_log (
      message_id, schema_ref, intent_id, correlation_id, causation_id,
      sender, recipient, sent_at, signature, trust, payload
    ) VALUES (
      v_env ->> 'message_id', v_schema_ref, v_env ->> 'intent_id',
      v_env ->> 'correlation_id', v_env ->> 'causation_id',
      v_env ->> 'sender', v_env ->> 'recipient',
      (v_env ->> 'sent_at')::timestamptz, v_env ->> 'signature',
      COALESCE(v_env -> 'trust', '{}'::jsonb), p_message -> 'payload'
    );
    RETURN NULL;
  END IF;

  SELECT COALESCE(s.mode, 'shadow') INTO v_mode FROM acs_message_schemas s WHERE s.schema_ref = v_schema_ref;
  IF COALESCE(v_mode, 'shadow') IN ('warn', 'enforce') THEN
    INSERT INTO acs_dead_letters (rejection_code, detail, raw, received_by)
    VALUES (v_code, 'acs_ingest_message rejection', p_message, p_received_by);
  END IF;
  RETURN v_code;
END $$;

REVOKE ALL ON FUNCTION acs_ingest_message(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_ingest_message(jsonb, text) TO service_role;
