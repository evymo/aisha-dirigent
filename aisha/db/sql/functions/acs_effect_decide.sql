-- Function: acs_effect_decide
CREATE OR REPLACE FUNCTION acs_effect_decide(p_effect_id text, p_decision jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_state text;
  v_hash  text;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'acs: service role required' USING ERRCODE = '42501';
  END IF;

  SELECT state, params_sha256 INTO v_state, v_hash FROM acs_pending_effects WHERE effect_id = p_effect_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'acs_effect_decide: unknown effect %', p_effect_id; END IF;
  IF v_state <> 'proposed' THEN RAISE EXCEPTION 'acs_effect_decide: effect % is %, not proposed', p_effect_id, v_state; END IF;
  IF (p_decision ->> 'params_sha256') IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'acs_effect_decide: params hash mismatch for % (R5 drift)', p_effect_id;
  END IF;
  UPDATE acs_pending_effects
  SET state = CASE WHEN p_decision ->> 'decision' = 'confirm' THEN 'confirmed' ELSE 'aborted' END,
      decision = p_decision,
      decided_at = now()
  WHERE effect_id = p_effect_id;
END $$;

REVOKE ALL ON FUNCTION acs_effect_decide(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_effect_decide(text, jsonb) TO service_role;
