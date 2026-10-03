-- Predikát nároku v InitPlanu, ne per řádek (2026-07-30): is_admin_or_staff
-- nezávisí na řádku, a přesto se vyhodnocovala 60 642× na jeden dotaz — EXPLAIN
-- přímého čtení pod authenticated ukázal Seq Scan s per-row filtrem ~13 s.
-- Obalení do poddotazu → jedno vyhodnocení; nárok beze změny (táž třída jako
-- li_source_registry_read, hlídá brána rls-predikat-a-indexy).
ALTER TABLE production_workflow_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage workflow steps" ON production_workflow_steps;
CREATE POLICY "Admins can manage workflow steps" ON production_workflow_steps
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
