-- Constraint: notification_preferences_questionnaire_period_check
-- Table: notification_preferences

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_preferences_questionnaire_period_check'
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_questionnaire_period_check
      CHECK (questionnaire_reminder_period IN ('morning', 'afternoon', 'evening'));
  END IF;
END $$;
