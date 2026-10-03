-- Seed: ai_cost_class_catalog — cold-start cost bands per task kind
--
-- Bands are deliberately conservative starting points; fn_estimate_task_cost
-- switches to real 30-day ai_runs percentiles once a kind has >= 5 finished
-- runs, so these values matter most on fresh installations.
--
-- Default decision posture derived from these bands when no ai_spend_policies
-- row matches (decided 2026-06-12): allow under usd_p90, ask above usd_p90,
-- deny above 3 × usd_p90.
--
-- Kinds cover the three task vocabularies:
--   ai_runs.kind        — chat, project_delivery, compliance_check,
--                         guild_review, pr_gate, incident, doc_update,
--                         reflection, proactive, ide_session
--   ai_tasks.task_type  — batch_analysis, data_export, evaluation_run,
--                         knowledge_sync, report_generation
--   agent_runs.kind     — plugin-exec, workflow-exec, repo-agent, doc-agent,
--                         claude_cli_task

INSERT INTO public.ai_cost_class_catalog
  (kind, cost_class, usd_p50, usd_p90, tokens_p90, description)
VALUES
  -- ai_runs.kind
  ('chat',             'micro',  0.02,  0.10,    50000, 'Interactive chat turn'),
  ('reflection',       'small',  0.15,  0.60,   200000, 'Reflection workflow run'),
  ('proactive',        'micro',  0.01,  0.05,    20000, 'Proactive trigger evaluation'),
  ('compliance_check', 'small',  0.10,  0.50,   150000, 'Compliance scan of a change set'),
  ('guild_review',     'medium', 0.50,  2.00,   500000, 'Multi-agent guild review'),
  ('pr_gate',          'small',  0.20,  0.80,   250000, 'PR gate evaluation'),
  ('incident',         'medium', 0.50,  3.00,   600000, 'Incident analysis + response'),
  ('doc_update',       'small',  0.10,  0.60,   200000, 'Documentation update run'),
  ('project_delivery', 'xl',     5.00, 20.00,  4000000, 'Full project delivery orchestration'),
  ('ide_session',      'large',  1.00,  8.00,  2000000, 'Interactive IDE/CLI work session (subscription runs budget in tokens)'),
  -- ai_tasks.task_type
  ('batch_analysis',   'medium', 0.50,  2.00,   800000, 'Batch document/data analysis'),
  ('data_export',      'micro',  0.02,  0.10,    30000, 'Structured data export'),
  ('evaluation_run',   'medium', 0.40,  1.50,   500000, 'Eval pipeline run over golden set'),
  ('knowledge_sync',   'small',  0.10,  0.50,   200000, 'Knowledge base sync/embedding'),
  ('report_generation','small',  0.20,  1.00,   300000, 'Report generation'),
  -- agent_runs.kind (isolated workloads)
  ('plugin-exec',      'small',  0.10,  0.50,   150000, 'Sandboxed plugin execution'),
  ('workflow-exec',    'medium', 0.30,  1.50,   400000, 'Sandboxed workflow execution'),
  ('repo-agent',       'large',  1.00,  6.00,  1500000, 'Repository agent (code changes)'),
  ('doc-agent',        'small',  0.20,  1.00,   300000, 'Documentation agent'),
  ('claude_cli_task',  'large',  1.00,  8.00,  2000000, 'AISHA-spawned Claude CLI story-branch run (subscription budgets in tokens)')
ON CONFLICT (kind) DO UPDATE SET
  cost_class  = EXCLUDED.cost_class,
  usd_p50     = EXCLUDED.usd_p50,
  usd_p90     = EXCLUDED.usd_p90,
  tokens_p90  = EXCLUDED.tokens_p90,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();
