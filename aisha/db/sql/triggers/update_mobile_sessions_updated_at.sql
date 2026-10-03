-- Trigger: update_mobile_sessions_updated_at
-- Table: mobile_sessions

CREATE TRIGGER update_mobile_sessions_updated_at
BEFORE UPDATE
ON public.mobile_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
