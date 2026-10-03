-- Index: idx_story_reminders_partner_upcoming
-- Table: story_reminders

CREATE INDEX idx_story_reminders_partner_upcoming ON public.story_reminders USING btree (partner_id, remind_at) WHERE (is_completed = false);
