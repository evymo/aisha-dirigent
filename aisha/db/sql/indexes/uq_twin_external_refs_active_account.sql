-- Index: uq_twin_external_refs_active_account
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
--
-- Invariant: JEDEN ÚČET = nejvýš JEDEN aktivní twin, bez ohledu na zdroj.
--
-- ⛔ PROČ NESTAČÍ `uq_twin_external_refs_active_owner`. Ten hlídá trojici
-- (source, source_key, ref_kind) — jenže ČTENÁŘ `source` IGNORUJE:
--
--     -- get_my_workflow_steps
--     where r.ref_kind = 'account'
--       and r.source_key = auth.uid()::text
--       and r.state = 'confirmed' ...
--
-- Dvě potvrzené vazby na týž účet s různým `source` (třeba 'aisha_auth'
-- a 'keycloak') tedy starým indexem PROJDOU OBĚ, obě padnou do `my_twins` —
-- a řidič uvidí dodávky dvou lidí. Neprojeví se to chybou ani prázdnem, ale
-- tím, že je vidět VÍC, což si nikdo nespojí s vadou vazby.
--
-- ⭐ Unikátnost patří na TU MNOŽINU SLOUPCŮ, kterou čtenář opravdu používá.
-- Kdyby se místo toho „opravil" čtenář (dofiltroval `source`), musel by ten
-- zdroj někdo zvolit — a stará data s jiným zdrojem by tiše zmizela z výsledku.
-- Uzavřít to indexem je bezpečnější směr: vadný zápis se NEPROVEDE, místo aby
-- se tiše nečetl.
--
-- Předání účtu (odchod řidiče) se dělá `valid_to`, ne mazáním — proto je
-- podmínka `valid_to IS NULL`: ukončené vazby se nezapočítávají a historie
-- zůstane.

CREATE UNIQUE INDEX IF NOT EXISTS uq_twin_external_refs_active_account
  ON public.twin_external_refs (source_key)
  WHERE ref_kind = 'account' AND state = 'confirmed' AND valid_to IS NULL;
