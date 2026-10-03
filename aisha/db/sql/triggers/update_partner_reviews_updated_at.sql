-- Trigger: update_partner_reviews_updated_at
-- Table: partner_reviews

CREATE TRIGGER update_partner_reviews_updated_at
    BEFORE UPDATE ON public.partner_reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
