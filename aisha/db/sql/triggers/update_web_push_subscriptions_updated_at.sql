-- Trigger: update_web_push_subscriptions_updated_at
-- Table: web_push_subscriptions

CREATE TRIGGER update_web_push_subscriptions_updated_at
    BEFORE UPDATE ON public.web_push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
