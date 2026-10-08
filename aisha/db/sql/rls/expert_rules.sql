-- RLS: expert_rules
--
-- Politiky čtení napřímo (anon, authenticated, service_role) žijí v jediném souboru
-- policies/expert_rules_visibility.sql (přehrává ho heals.sql). Do 2026-10-05 tu byly jejich druhé
-- kopie s jiným tělem a do běžících databází nedoteklo ani jedno (soubor politik v heals nebyl).

ALTER TABLE public.expert_rules ENABLE ROW LEVEL SECURITY;
