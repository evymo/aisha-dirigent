-- Index: idx_pws_assigned_role
-- Nárokové rameno „role": get_workflow_my_steps_block filtruje
-- s.assigned_role = any(scope.my_roles) — s indexem BitmapOr, surový dotaz
-- 1,5 ms na 60 642 krocích (2026-07-30). Jeden index na soubor: generátor
-- baseline páruje soubor se jménem indexu.
CREATE INDEX IF NOT EXISTS idx_pws_assigned_role
  ON public.production_workflow_steps (assigned_role);
