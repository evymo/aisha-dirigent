# P0 – Gateway pro download dokumentů

> NOTE (2025-12-14): Tento P0 dokument je konsolidován do `docs/security/SECURITY.md`. Tento soubor ponecháváme jako detailní technický popis.

Cíl tohoto kroku je odstranit přímé generování signed URL z browseru a umožnit bezpečné stahování i pro sdílené dokumenty (partner/study), aniž bychom museli rozšiřovat Storage policy o složité joiny.

## Co je implementováno

- Edge Function `download-health-document`:
  - Ověří JWT uživatele.
  - Přes RLS (user-scoped DB dotaz) ověří oprávnění k dokumentu `member_health_documents`.
  - Vydá krátkodobé signed URL (default 5 minut) pomocí service role (pouze pro signing Storage URL).
  - Enforcuje základní per-user rate limit (50 download URL / hod).
  - Zapíše událost do `audit_journal` přes `log_user_action`.

## Proč je to důležité

- Storage policy pro bucket `private-documents` dnes povoluje pouze owner read přes `foldername(name)[1]`.
- RLS na `member_health_documents` už umí povolit SELECT partnerům při explicitním share.
- Bez gateway tedy partner může vidět metadata dokumentu, ale nemůže bezpečně stáhnout soubor.
- Gateway zachovává storage bucket jako private a přístup dělá přes serverové rozhodnutí.

## Konfigurace

Edge Functions vyžadují tyto secrets (Supabase):

- `AISHA_POSTGREST_URL`
- `AISHA_POSTGREST_ANON_KEY`
- `AISHA_POSTGREST_SERVICE_KEY`
- `ALLOWED_ORIGINS` – čárkou oddělený allowlist originů (např. `https://app.example.com,https://staging.example.com,http://localhost:5173`; podporuje i host-only `staging.example.com` a wildcard subdomény `*.example.com`)

Poznámka: v produkci nedoporučuji používat `*`.

## Deploy

- Lokální vývoj: `supabase start`
- Nasazení funkce: `supabase functions deploy download-health-document`
- Nastavení secrets: `supabase secrets set ALLOWED_ORIGINS=...`

## Klientská změna

- Klient už nepoužívá `supabase.storage.createSignedUrl()` pro dokumenty.
- Hook `getDocumentUrl()` nyní volá `supabase.functions.invoke('download-health-document', { documentId })`.

## DoD (Definition of Done)

- Funkce vrací 200 + `signedUrl` pouze pro uživatele, kteří mají přístup přes RLS.
- Pro neoprávněné požadavky vrací 404 (bez leakování existence).
- Pro překročení rate limitu vrací 429.
- `audit_journal` obsahuje záznamy pro `download URL issued/denied` (viditelné admin/staff).
- `npm run test:run` a `npm run build` prochází.
