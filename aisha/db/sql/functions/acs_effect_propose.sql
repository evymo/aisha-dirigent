-- Function: acs_effect_propose
CREATE OR REPLACE FUNCTION acs_effect_propose(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'acs: service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO acs_pending_effects (effect_id, intent_id, tool_name, effect_class, proposal, params_sha256)
  VALUES (
    p_payload ->> 'effect_id',
    p_payload ->> 'intent_ref',
    p_payload ->> 'tool_name',
    p_payload ->> 'effect_class',
    p_payload -> 'proposal',
    p_payload -> 'proposal' ->> 'params_sha256'
  );
  RETURN p_payload ->> 'effect_id';
END $$;

REVOKE ALL ON FUNCTION acs_effect_propose(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_effect_propose(jsonb) TO service_role;
