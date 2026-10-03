-- ============================================================================
-- STEP 31: Feature and Issue Catalogs
-- ============================================================================

-- Feature catalog (modules/add-ons available on the platform)
INSERT INTO public.product_catalog (code, category, is_active) VALUES
  ('analytics-module',   'module',      true),
  ('reporting-suite',    'module',      true),
  ('team-collaboration', 'module',      true),
  ('api-gateway',        'integration', true),
  ('workflow-engine',    'module',      true),
  ('security-pack',      'add-on',      true)
ON CONFLICT (code) DO UPDATE SET category = EXCLUDED.category, is_active = EXCLUDED.is_active;

-- Issue catalog (common user-reported issues/feedback categories)
INSERT INTO public.symptom_catalog (code, category, is_active) VALUES
  ('slow-performance',     'performance', true),
  ('ui-confusion',         'usability',   true),
  ('missing-feature',      'feature',     true),
  ('data-export-issues',   'data',        true),
  ('integration-problems', 'integration', true),
  ('notification-overload','usability',   true),
  ('access-permission',    'security',    true),
  ('mobile-app-issues',    'mobile',      true)
ON CONFLICT (code) DO UPDATE SET category = EXCLUDED.category, is_active = EXCLUDED.is_active;
