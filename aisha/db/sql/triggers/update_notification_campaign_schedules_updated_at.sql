-- Trigger: update_notification_campaign_schedules_updated_at
-- Table: notification_campaign_schedules

CREATE TRIGGER update_notification_campaign_schedules_updated_at
    BEFORE UPDATE ON public.notification_campaign_schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
