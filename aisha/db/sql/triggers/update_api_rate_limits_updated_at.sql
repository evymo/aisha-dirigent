-- Trigger: update_api_rate_limits_updated_at
-- Table: api_rate_limits

CREATE TRIGGER update_api_rate_limits_updated_at
    BEFORE UPDATE ON public.api_rate_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
