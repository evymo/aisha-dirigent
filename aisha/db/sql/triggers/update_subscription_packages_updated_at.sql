-- Trigger: update_subscription_packages_updated_at
-- Table: subscription_packages

CREATE TRIGGER update_subscription_packages_updated_at
    BEFORE UPDATE ON public.subscription_packages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
