-- Index: idx_vial_assignments_user_id
-- Table: vial_assignments

CREATE INDEX IF NOT EXISTS idx_vial_assignments_user_id ON public.vial_assignments(user_id);
