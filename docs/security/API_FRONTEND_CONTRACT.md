# API ↔ Frontend kontrakt (Supabase)

Tento dokument sjednocuje očekávání a best practices pro rozhraní mezi frontend aplikací a naším „API“ (Supabase DB + Edge Functions), se zvláštním důrazem na sensitive-data/production bezpečnost.

## Principy (production)

- Zdroj pravdy pro oprávnění je vždy DB (RLS/policies); UI guardy jsou jen UX.
- Nikdy neloguj sensitive data ani payloady requestů/response; používej `safeError/safeWarn` jen s bezpečným kontextem.
- Fail-closed v produkci: při nejistotě (chybějící env, invalid response schema) raději selhat než fallback na méně bezpečný přístup.

## Edge Functions (API)

- Autentizované (sensitive data) funkce vždy vyžadují `Authorization: Bearer ...` a používají user-scoped Supabase klient pro RLS.
- Service-role klient je povolen jen pro ne-sensitive-data operace typu: rate-limit counting, audit zápisy, Storage signing.
- Response těla:
  - Úspěch: JSON objekt se stabilní strukturou (např. `signedUrl`, `documentId`…).
  - Chyba: `{ error: "…" }` + správný HTTP status (401/403/404/429/5xx) bez detailů/sensitive-data.

## Frontend (konzumace API)

- sensitive data operace (dokumenty, citlivá data) běží přes `phiClient` (in-memory session, bez persistence).
- Veřejná/non‑sensitive data mohou jít přes běžný `supabase` klient nebo přes public Edge Function (kvůli CORS/rate limitům).
- Pro volání Edge Functions používej jednotně `invokeEdgeFunction` z `src/integrations/api/edge.ts`:
  - Validuj response přes Zod schema (bez logování raw dat).
  - Při chybě schema/invoke v produkci fail-closed; v dev lze fallback jen explicitně a bezpečně.

## Konfigurace prostředí (Supabase)

- `src/integrations/supabase/client.ts` defaultně fall-backuje na embedded dev projekt, pokud chybí `VITE_AISHA_POSTGREST_URL` + klíč (pro bootovatelné preview/demo buildy).
- Pro fail-fast nastav `VITE_REQUIRE_AISHA_POSTGREST_ENV=true` (legacy alias: `VITE_DISABLE_DEMO_BUILD=true`).
