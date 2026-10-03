-- Index: idx_vial_assignments_assigned_by
-- Table: vial_assignments

CREATE INDEX IF NOT EXISTS idx_vial_assignments_assigned_by ON public.vial_assignments(assigned_by);
