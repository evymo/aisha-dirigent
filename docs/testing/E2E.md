# E2E testování (Playwright)

Tento projekt je produkční aplikace. E2E testy musí běžet proti **lokální Supabase** (ne proti produkci) a nesmí obsahovat ani ukládat sensitive-data.

## Rychlý start (lokálně)

Předpoklady:
- Docker Desktop běží
- Node.js 22+
- Playwright browsery nainstalované (poprvé): `npx playwright install`

Doporučený one-liner:

- `npm run test:e2e:local`
- `npm run test:e2e:tokenomics:local`
- `npm run test:e2e:tokenomics:container`

Co to dělá:
- `npx supabase start`
- pokusí se aplikovat migrace do lokální DB (`npm run db:migrate:local`), ale při známém lokálním driftu pokračuje nad existujícím stavem DB
- zvedne doplňkové kontejnery pro tokenomics stack (`redis`, `n8n`, `rabbitmq`)
- spustí `playwright test`

## Kontejnerový běh

Pro běh Playwrightu v kontejneru použij:

- `npm run test:e2e:container`
- `npm run test:e2e:tokenomics:container`

Container runner:
- nechá backend stack běžet lokálně přes Docker Compose / Supabase
- spustí Vite E2E server na `127.0.0.1:4173`
- pustí Playwright v oficiálním image `mcr.microsoft.com/playwright:v1.59.1-jammy`

## Test Uživatelé (Role)

Migrace automaticky vytváří seed uživatele pro různé role:

| Role | Email | Heslo | Popis |
|------|-------|-------|-------|
| **Admin** | admin@platform.rtn | Admin123! | Full system access |
| **Member** | member@platform.rtn | Member123! | Regular platform user |
| **Partner** | partner@platform.rtn | Partner123! | Production provider |
| **Staff** | staff@platform.rtn | Staff123! | Limited admin staff |

## Playwright Projekty

Testy jsou organizovány podle role uživatele:

| Projekt | Soubory | Auth State | Popis |
|---------|---------|------------|-------|
| `setup` | `*.setup.ts` | - | Vytváří auth states pro všechny role |
| `chromium-admin` | `*.admin.spec.ts` | admin.json | Admin panel, správa systému |
| `chromium-member` | `*.member.spec.ts` | member.json | Členská sekce, check-iny |
| `chromium-partner` | `*.partner.spec.ts` | partner.json | Partner dashboard, uživateli |
| `chromium-public` | `*.public.spec.ts` | - | Veřejné stránky, login |
| `smoke` | `*.smoke.spec.ts` | - | Rychlé smoke testy (bez auth) |

## Běžné příkazy

### Spuštění testů podle role

```bash
# Všechny testy
npm run test:e2e

# Pouze admin testy
npm run test:e2e:admin

# Pouze member testy
npm run test:e2e:member

# Pouze partner testy
npm run test:e2e:partner

# Pouze public/auth testy
npm run test:e2e:public

# Smoke testy (rychlé, bez auth)
npm run test:e2e:smoke
```

### Lokální Supabase

```bash
npm run supabase:start    # Start Docker kontejnerů
npm run supabase:stop     # Stop
npm run supabase:status   # Zobrazí URL a klíče
```

### Ruční lokální vývoj (bez E2E)

```bash
npm run dev:local         # Dev server s lokální Supabase
```

### Migrace

```bash
npm run db:migrate:local  # Aplikuje migrace do lokální DB
npm run db:status:local   # Stav lokální DB
```

### E2E tooling

```bash
npm run test:e2e:ui       # Interaktivní UI runner
npm run test:e2e:headed   # S viditelným prohlížečem
npm run test:e2e:debug    # Debug mód
npm run test:e2e:report   # Zobrazí report
```

### Lokální kompletní flow

```bash
# Doporučeno - spustí vše automaticky
npm run test:e2e:local

# Tokenomics / blockchain stack
npm run test:e2e:tokenomics:local

# Stejný suite v Playwright kontejneru
npm run test:e2e:tokenomics:container
```

## Jak je řešená lokální Supabase konfigurace pro E2E

Playwright v [playwright.config.ts](../../playwright.config.ts) startuje dev server příkazem `npm run dev:e2e`.

Tento skript ([scripts/e2e/start-dev-for-e2e.mjs](../../scripts/e2e/start-dev-for-e2e.mjs)):
- nastaví `VITE_AISHA_POSTGREST_URL` (+ `VITE_AISHA_POSTGREST_PUBLISHABLE_KEY` / `VITE_AISHA_POSTGREST_ANON_KEY`) na lokální stack
- spustí Vite na portu 4173 se `--strictPort`

Díky tomu E2E testy nepadnou na „local backend nemá auth" jen proto, že frontend mířil na remote fallback.

## Přidání nového testu

### Pro admin roli

```typescript
// e2e/my-feature.admin.spec.ts
import { test, expect } from "@playwright/test";

test.describe("My Admin Feature", () => {
  test("admin může vidět feature", async ({ page }) => {
    await page.goto("/admin/my-feature");
    // ...assertions
  });
});
```

### Pro member roli

```typescript
// e2e/my-feature.member.spec.ts
import { test, expect } from "@playwright/test";

test.describe("My Member Feature", () => {
  test("member může vidět feature", async ({ page }) => {
    await page.goto("/member/my-feature");
    // ...assertions
  });
});
```

### Pro public (neautorizovaný)

```typescript
// e2e/my-page.public.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Public Page", () => {
  test("stránka je přístupná bez přihlášení", async ({ page }) => {
    await page.goto("/my-public-page");
    // ...assertions
  });
});
```

## Remote E2E (např. alfa)

Pokud chceš spouštět testy proti remote prostředí, nastav:
- `E2E_BASE_URL=https://...`
- případně `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` atd.

Rychlá smoke kontrola proti remote:
- `E2E_BASE_URL=https://... npm run test:e2e:smoke`

V tom případě Playwright **nespouští lokální webServer** (viz konfigurace) a jde přímo proti remote URL.

## Troubleshooting

### Dev server se hned ukončí při E2E
E2E webserver je lifecycle-managed Playwrightem a po doběhnutí testů se ukončí schválně.
Pro ruční běh appky používej `npm run dev`.

### Port 4173 je obsazený
Vite s `--strictPort` failne. Uvolni port nebo ukonči proces na 4173.

### Login v E2E padá
1. Ověř že lokální Supabase běží: `npm run supabase:status`
2. Ověř že migrace doběhly: `npm run db:status:local`
3. Seed uživatelé:
   - Admin: `admin@app.example` / `Admin123!`
   - Member: `member@app.example` / `Member123!`
   - Partner: `partner@app.example` / `Partner123!`

### „Local backend nemá auth"
Typicky frontend mířil na remote fallback Supabase. E2E režim (`dev:e2e`) to vynuceně přepíná na lokál.

### Auth state soubory chybí
Auth states se generují při běhu `setup` projektu. Pokud neexistují, spusť:
```bash
npm run test:e2e -- --project=setup
```

### Nový seed uživatel nefunguje
Ověř že:
1. Existuje záznam v `auth.users`
2. Existuje záznam v `auth.identities` (GoTrue vyžaduje)
3. Existuje `public.profiles` s `has_password = true`
4. Existuje `public.user_roles` s příslušnou rolí

## Edge Functions lokální testování

Edge Functions jsou automaticky spouštěny při `npm run test:e2e:local` (skript `run-local.mjs`).

### Manuální spuštění Edge Functions

```bash
# Vyžaduje běžící Docker + lokální Supabase
npm run supabase:start
npm run supabase:functions:serve
```

### Testování Edge Functions

E2E testy pro Edge Functions jsou v `e2e/edge-functions.spec.ts`. Testují:
- `public-partners-directory` - veřejný seznam partnerů
- `mobile-app-version` - verze mobilní aplikace
- `ai-chat` - AI chatbot (vyžaduje auth)
- `analyze-health-document` - analýza dokumentů (vyžaduje auth)

### Troubleshooting Edge Functions

#### Docker není spuštěn
```
Cannot connect to the Docker daemon
```
→ Spusť Docker Desktop a počkej až je plně ready.

#### Functions vrací 500
1. Zkontroluj logy: `npm run supabase:functions:serve` (v popředí)
2. Ověř env proměnné: `OPENAI_API_KEY` pro AI funkce
3. Ověř CORS: Origin header musí odpovídat allowlistu

#### JWT verification fails
Při lokálním testování používej `--no-verify-jwt` flag (už je v `supabase:functions:serve`).

