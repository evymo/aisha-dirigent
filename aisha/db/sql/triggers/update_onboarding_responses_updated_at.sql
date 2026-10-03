-- Trigger: update_onboarding_responses_updated_at
-- Table: onboarding_responses

CREATE TRIGGER update_onboarding_responses_updated_at
    BEFORE UPDATE ON public.onboarding_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
