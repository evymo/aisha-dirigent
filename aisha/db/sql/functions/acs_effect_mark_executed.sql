-- Function: acs_effect_mark_executed
CREATE OR REPLACE FUNCTION acs_effect_mark_executed(p_effect_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_state text;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'acs: service role required' USING ERRCODE = '42501';
  END IF;

  SELECT state INTO v_state FROM acs_pending_effects WHERE effect_id = p_effect_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'acs_effect_mark_executed: unknown effect %', p_effect_id; END IF;
  IF v_state <> 'confirmed' THEN
    RAISE EXCEPTION 'acs_effect_mark_executed: effect % is %, not confirmed (R5)', p_effect_id, v_state;
  END IF;
  UPDATE acs_pending_effects SET state = 'executed', executed_at = now() WHERE effect_id = p_effect_id;
END $$;

REVOKE ALL ON FUNCTION acs_effect_mark_executed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_effect_mark_executed(text) TO service_role;
