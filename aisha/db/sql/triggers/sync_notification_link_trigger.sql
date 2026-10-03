-- Trigger: sync_notification_link_trigger
-- Table: notifications

CREATE TRIGGER sync_notification_link_trigger
BEFORE INSERT OR UPDATE
ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION sync_notification_link();
