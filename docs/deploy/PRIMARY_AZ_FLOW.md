# Primary A-Z Flow

Toto je canonical cesta pro vetsinu vyvojaru.

Scope tohoto dokumentu je jen hlavni osa:

1. local setup
2. vyvoj
3. CI
4. web deploy

Optional stacky (core, n8n, langfuse, admin) jsou mimo primary flow.

## Step 1: Local Setup

Pouzij jednu z techto dvou variant:

- Guided: `npm run cockpit`
- Scriptable fallback: `npm run setup`

Vysledek: bezici lokalni prostredi pro vyvoj.

## Step 2: Development Loop

1. Implementuj zmenu.
2. Spust relevantni testy.
3. Over lokalni kvalitu:

```bash
npm run lint
npm run test:run -- <relevantni-test>
```

Poznamka: pred push do main musi projit gates a build.

## Step 3: One-Time Deploy Bootstrap

Toto je jednorazove nastaveni napojeni Forgejo -> Coolify:

```bash
npm run deploy:init
```

Co to dela:

1. najde/nebo sparuje Coolify web stack
2. nastavi required env vars
3. nastavi Forgejo secret `COOLIFY_WEBHOOK_URL`

Detailni postup je v [COOLIFY_SETUP.md](COOLIFY_SETUP.md).

## Step 4: Deploy to Web Production

Bezny deploy flow je jednoduchy:

1. `git push` do `main`
2. CI (GitHub Actions) provede checks, testy a build
3. CI nasadi pres Coolify API (opt-in: proměnná repozitáře `APP_NAME_PREFIX`)
4. Coolify nasadi web stack (`docker-compose.coolify-prebuilt.yml`)

To je vse. Pro web produkci neni potreba spoustet core/langfuse/admin stacky.

## Roles of Main Tools

- `cockpit`: guided onboarding a local bootstrap
- `setup.sh`: scriptable first-time local setup
- `warmup.sh`: stage-based verify/recovery workflow
- `deploy:init`: one-time deployment bootstrap
- `.github/workflows/ci.yml`: gate + build + deploy orchestrace

## Out of Scope (Advanced)

Nasledujici workflows nejsou soucast primary A-Z cesty:

- full self-hosted core stack
- n8n orchestrace provisioning
- langfuse observability stack
- admin stack (NocoDB/Appsmith)

Pouzij je az po zvladnuti primary flow.
