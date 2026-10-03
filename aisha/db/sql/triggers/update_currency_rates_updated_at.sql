-- Trigger: update_currency_rates_updated_at
-- Table: currency_rates

CREATE TRIGGER update_currency_rates_updated_at
    BEFORE UPDATE ON public.currency_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
