-- Trigger: update_notification_campaigns_updated_at
-- Table: notification_campaigns

CREATE TRIGGER update_notification_campaigns_updated_at
    BEFORE UPDATE ON public.notification_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
