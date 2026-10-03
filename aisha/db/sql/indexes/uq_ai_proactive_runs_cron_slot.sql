-- Index: uq_ai_proactive_runs_cron_slot
-- Jeden běh CRON pravidla na jeden slot rozvrhu (record_cron_proactive_run,
-- ON CONFLICT … DO NOTHING). Partial jen na CRON běhy — běhy ze zdrojových zápisů
-- `cron_slot` nenesou a unikátnost se jich netýká (pravidlo nad UPDATE smí po
-- cooldownu na tomtéž záznamu vystřelit znovu).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_proactive_runs_cron_slot
  ON public.ai_proactive_runs (trigger_definition_id, ((metadata ->> 'cron_slot')))
  WHERE (metadata ? 'cron_slot');
