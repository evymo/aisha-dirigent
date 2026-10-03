-- STEP 11: System Configuration
-- ============================================================================

INSERT INTO public.system_config (key, value, description) VALUES
  ('maintenance_mode', 'false', 'Enable maintenance mode'),
  ('registration_enabled', 'true', 'Allow new user registration'),
  ('require_email_verification', 'true', 'Require email verification for new accounts'),
  ('default_language', '"en"', 'Default application language (terminal i18n failover; per-user locale overrides)'),
  ('commerce_base_locale', '"en"', 'Base/default locale the instance falls back to (resolved via public.commerce_base_locale())'),
  ('email_branding', '{"brand_name":"Platform","support_email":"support@platform.com","logo_path":"branding/logo"}', 'Email branding used in auth templates'),
  ('session_timeout_minutes', '30', 'Session timeout for general sessions'),
  ('phi_session_timeout_minutes', '30', 'Session timeout for sensitive data access'),
  ('max_failed_logins', '5', 'Max failed login attempts before lockout'),
  ('password_min_length', '12', 'Minimum password length'),
  ('require_mfa_for_admin', 'true', 'Require MFA for admin users'),
  ('min_certification_level_for_partner', '1', 'Minimum certification level required for partner status'),
  ('qualification_test_pass_rate', '70', 'Pass rate percentage for qualification test'),
  ('partner_certification_pass_rate', '80', 'Pass rate percentage for partner certification'),
  ('commerce_base_currency', '"CZK"', 'Base currency for commerce prices')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

UPDATE public.system_config
SET is_public = true
WHERE key IN ('email_branding', 'commerce_base_currency', 'commerce_base_locale', 'default_language');

-- svc-agent-runner dynamic caps (Component 4). Runtime-tunable safety limits for
-- claude_cli_task spawning — the runner re-reads these (get_system_config) on a
-- short TTL, so an operator/AISHA changes a value and it takes effect without a
-- redeploy. DO NOTHING on conflict: a re-seed must NEVER clobber operator tuning.
-- is_public=true so the service_role runner (auth.uid() NULL) can read them; these
-- are operational limits, not secrets. Defaults are the conservative fail-safe
-- (poller OFF until a host is explicitly sized + enabled).
INSERT INTO public.system_config (key, value, description) VALUES
  ('agent_runner',
   '{"poll_enabled": false, "max_concurrent": 3, "poll_interval_ms": 5000, "poll_grace_seconds": 10, "exec_memory_limit": "1g", "max_inflight": 50, "cli_timeout_ms": 3600000}',
   'svc-agent-runner dynamic caps: claude_cli_task poll/concurrency/memory/queue limits (runtime-tunable)')
ON CONFLICT (key) DO NOTHING;

UPDATE public.system_config SET is_public = true WHERE key = 'agent_runner';

-- ai_runtime — warm thresholds for the odysseus wave (impl/08 §4): untrusted
-- wrapper re-scan (02), context budget/compaction (03), deep research (04).
-- ONE key, ONE loader (svc-ai-chat getAiRuntimeConfig, getRunnerCaps pattern),
-- ZERO new RPCs: read via get_system_config, admin writes via the existing
-- audited set_system_config_admin. DO NOTHING on conflict: a re-seed must
-- NEVER clobber operator tuning. is_public=true — operational thresholds, not
-- secrets; service_role readers (auth.uid() NULL) need them.
-- context_budget_headroom=0.7 (NOT 0.85): estimateTokens (chars/4)
-- underestimates code/JSON/CJK — impl/09 §B-3 guardrail. Feature FLAGS stay
-- in env (deploy-time); this row carries runtime-tunable thresholds only.
INSERT INTO public.system_config (key, value, description) VALUES
  ('ai_runtime',
   '{"untrusted_rescan_profiles": ["critical_flow", "high_risk"], "injection_rescan_threshold": 0.7, "context_budget_headroom": 0.7, "context_budget_hard_max": 200000, "compact_threshold": 0.85, "compact_keep_last_turns": 6, "compact_summary_max_tokens": 1024, "research_max_rounds": 3, "research_budget_tokens": 100000, "research_budget_time_ms": 300000, "eval_min_overall_score": 0.6}',
   'AI runtime thresholds (odysseus wave): untrusted re-scan profiles, context budget/compaction, deep-research envelopes (runtime-tunable)')
ON CONFLICT (key) DO NOTHING;

UPDATE public.system_config SET is_public = true WHERE key = 'ai_runtime';
