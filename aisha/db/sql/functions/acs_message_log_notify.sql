-- Function: acs_message_log_notify
-- NOTIFY carries ONLY the message id (8 kB pg_notify limit + pass-by-reference
-- on the transport layer): consumers read the row, never a payload copy.
CREATE OR REPLACE FUNCTION acs_message_log_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('acs_message', json_build_object('acs_message_id', NEW.message_id)::text);
  RETURN NEW;
END $$;
