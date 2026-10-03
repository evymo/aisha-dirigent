-- RLS pro federated_source_sessions a federated_flow_nonces.
--
-- ⛔ ZÁMĚRNĚ BEZ JEDINÉ POLICY (vzor agent_knowledge_source_secrets). Zapnutá RLS
-- bez povolujícího pravidla = přes PostgREST se k řádkům NEDOSTANE NIKDO, ani admin.
-- Přístup má jen SECURITY DEFINER funkce se stráží is_service_role(). Šifrotext je
-- pořád tajemství, jen hůř čitelné.
ALTER TABLE public.federated_source_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.federated_flow_nonces ENABLE ROW LEVEL SECURITY;
