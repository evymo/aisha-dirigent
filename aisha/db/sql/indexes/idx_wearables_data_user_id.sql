-- Index: idx_wearables_data_user_id
-- Table: wearables_data

CREATE INDEX IF NOT EXISTS idx_wearables_data_user_id ON public.wearables_data(user_id);
