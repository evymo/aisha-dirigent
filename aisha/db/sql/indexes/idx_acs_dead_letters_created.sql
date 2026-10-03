-- Index: idx_acs_dead_letters_created

CREATE INDEX IF NOT EXISTS idx_acs_dead_letters_created ON public.acs_dead_letters (created_at);
