# P0 – Upload preflight pro dokumenty

> NOTE (2025-12-14): Tento P0 dokument je konsolidován do `docs/security/SECURITY.md`. Tento soubor ponecháváme jako detailní technický popis.

Cíl tohoto kroku je odstranit přímý upload do Storage z browseru a nahradit ho flow:

1) Klient požádá backend (Edge Function) o **signed upload URL**.
2) Backend vytvoří DB záznam + vygeneruje **signed upload token**.
3) Klient nahraje soubor přes `uploadToSignedUrl` bez potřeby Storage oprávnění.

Tím se sníží riziko IDOR/broken access control a sjednotí se přístupový model se stahováním (gateway).

## Co je implementováno

- Edge Function `upload-health-document-preflight`:
  - Ověří JWT uživatele.
  - Validuje metadata (category, mimeType, size).
  - Vytvoří záznam v `member_health_documents` (RLS enforced, owner = `auth.uid()`).
  - Vygeneruje signed upload URL/token pro bucket `private-documents`.
  - Zapíše událost do `audit_journal` přes `log_user_action`.

## Konfigurace

Stejné secrets jako ostatní gateway funkce:

- `AISHA_POSTGREST_URL`
- `AISHA_POSTGREST_ANON_KEY`
- `AISHA_POSTGREST_SERVICE_KEY`
- `ALLOWED_ORIGINS` – allowlist originů

## Deploy

- `supabase functions deploy upload-health-document-preflight`

## Klientská změna

- Hook `useUploadActivityDocument()` už nepoužívá přímé `supabase.storage.upload(...)`.
- Místo toho:
  - volá `supabase.functions.invoke('upload-health-document-preflight', ...)`
  - nahraje soubor přes `supabase.storage.from('private-documents').uploadToSignedUrl(path, token, ...)`

## Poznámka k expiraci

Supabase Storage signed upload URL mají aktuálně expiraci **2 hodiny** (bez možnosti nastavit kratší TTL přes API). Riziko je mitigováno:

- náhodným object key (neuhodnutelný),
- CORS allowlist na Edge Function,
- per-user rate limiting na preflight.

## DoD

- Preflight vrací token pouze autentizovanému uživateli.
- DB insert je vždy vynucen RLS (uživatel nemůže vytvořit dokument pro cizí `user_id`).
- Upload z klienta jde pouze přes signed upload token.
- `npm run test:run` a `npm run build` prochází.
