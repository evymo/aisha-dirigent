-- Grants: app_secrets
--
-- ⛔ NEŠIFROVANÁ TAJEMSTVÍ (naměřeno 2026-09-28 na riq): tabulka měla SELECT pro
-- `anon` a ALL pro `authenticated`/`service_role`; chránila ji jen RLS politika
-- „admin" (force off). Každý admin — nebo útok přes jeho relaci — přečetl hodnoty
-- přímo `GET /rest/v1/app_secrets`. Čtenáři jsou výhradně SECURITY DEFINER
-- funkce (běží jako vlastník), přímý grant proto nepotřebuje nikdo.
-- Tajemství mají domov v trezoru (vault.secrets, šifrovaně); tahle tabulka je
-- dočasný zdroj převodu (migrate_app_secrets_to_vault) a po ověření se vyprázdní.

REVOKE ALL ON public.app_secrets FROM PUBLIC, anon, authenticated, service_role;
