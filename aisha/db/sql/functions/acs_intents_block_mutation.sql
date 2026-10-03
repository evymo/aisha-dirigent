-- Function: acs_intents_block_mutation
CREATE OR REPLACE FUNCTION acs_intents_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acs_intents is immutable (R3): % on % is not allowed', TG_OP, OLD.intent_id
    USING ERRCODE = 'raise_exception';
END $$;
