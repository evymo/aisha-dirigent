# P0 – Hardening AI analýzy dokumentů

> NOTE (2025-12-14): Tento P0 dokument je konsolidován do `docs/security/SECURITY.md`. Tento soubor ponecháváme jako detailní technický popis.

Cíl: snížit riziko exfiltrace sensitive data přes AI pipeline (Edge Function + externí provider) na úroveň srovnatelnou s download/upload gateway.

## Co je implementováno

Edge Function `analyze-health-document` nyní:

- Enforcuje **CORS allowlist** přes `ALLOWED_ORIGINS` (žádné globální wildcard `*` v produkci pro citlivé endpointy; podporujeme však wildcard subdomény jako `*.example.com`).
- Ověří **JWT** (Bearer token) a používá **user-scoped Supabase klienta** (`AISHA_POSTGREST_ANON_KEY`) pro:
  - ověření uživatele,
  - autorizaci přístupu přes **RLS**,
  - update dokumentu (status + výsledky) pouze pro ownera.
- Zavádí **P0 omezení scope**: analýzu může spustit pouze **owner dokumentu**.
- Enforcuje **souhlas**: vyžaduje aktivní `consents` záznam pro `consent_type = 'data_processing'`.
- Enforcuje **size cap**: max 10 MB pro analýzu (413 při překročení).
- Enforcuje **rate limiting**: 5 analýz / hod / uživatel.
  - P0 implementace používá počítání záznamů v `audit_journal` (summary: `Activity document analysis started`).
- Zapisuje **audit trail** přes RPC `log_user_action`:
  - started / completed / denied / failed / rate limited.

## Minimalizace a redakce dat

- Funkce neposílá do AI žádná binární data (žádné base64 obrázků, žádný raw PDF obsah).
- Pro textově čitelné dokumenty dělá best-effort `Blob.text()` a:
  - omezí vstup na 4000 znaků,
  - provede základní redakci (email/telefon/datum/SSN-like),
  - uloží do auditu pouze `sha256` hash redigovaného AI inputu (ne obsah).

Poznámka: redakce je „best effort“ a není plnohodnotná de-identifikace. Pro P1 doporučuji NER-based DLP pipeline.

## Secrets / konfigurace

- `AISHA_POSTGREST_URL`
- `AISHA_POSTGREST_ANON_KEY`
- `AISHA_POSTGREST_SERVICE_KEY` (pouze pro rate limit counting)
- `ALLOWED_ORIGINS` (comma-separated allowlist; podporuje i host-only `alfa.example.com` a wildcard subdomény `*.example.com`)

## Deploy

- `supabase functions deploy analyze-health-document`
- `supabase secrets set ALLOWED_ORIGINS=...`

## DoD

- CORS: disallowed Origin → 403.
- Bez JWT → 401.
- Ne-owner → 404 (no-leak).
- Chybí consent → 403.
- Nad limit → 429 + audit.
- `npm run test:run` a `npm run build` prochází.
