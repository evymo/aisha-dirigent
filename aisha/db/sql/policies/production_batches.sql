-- Predikát nároku v InitPlanu, ne per řádek (2026-07-30) — 20 214 řádků; táž
-- třída jako production_workflow_steps, viz komentář tam.
ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage batches" ON production_batches;
CREATE POLICY "Admins can manage batches" ON production_batches
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
