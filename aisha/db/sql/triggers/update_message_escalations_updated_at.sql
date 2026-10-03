-- Trigger: update_message_escalations_updated_at
-- Table: message_escalations

CREATE TRIGGER update_message_escalations_updated_at
BEFORE UPDATE
ON public.message_escalations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
