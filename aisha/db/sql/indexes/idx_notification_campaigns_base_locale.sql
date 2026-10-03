-- Index: idx_notification_campaigns_base_locale
-- Table: notification_campaigns

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_base_locale ON public.notification_campaigns(base_locale);
