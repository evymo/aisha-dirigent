-- Function: acs_message_log_block_mutation
CREATE OR REPLACE FUNCTION acs_message_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acs_message_log is append-only (R6): % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END $$;
