-- ============================================================================
-- §11 data-sensitivity registry — baseline confidential anchors
-- ----------------------------------------------------------------------------
-- The DB-driven source of truth for on-prem residency. These three were the
-- hardcoded CONFIDENTIAL_ANCHOR_TABLES literal in svc-ai-chat; operators now
-- add/modify rows here (no code change) to extend residency coverage. The svc
-- still fails SAFE to this same baseline if the registry is unreachable, so
-- behaviour is preserved on day one. Idempotent.
-- ============================================================================
INSERT INTO public.data_sensitivity_registry (table_name, sensitivity, category, note) VALUES
  ('member_health_documents', 'confidential', 'phi', 'Member health documents (PHI) — on-prem only'),
  ('dosing_logs',             'confidential', 'phi', 'Supplement/medication dosing logs (PHI) — on-prem only'),
  ('longevity_scores',        'confidential', 'phi', 'Derived longevity scores (PHI) — on-prem only')
ON CONFLICT (table_name) DO NOTHING;
