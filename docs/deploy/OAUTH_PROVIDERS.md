# OAuth Providers — Google & Apple Sign-In

> Návod pro nastavení přihlašování přes Google a Apple v self-hosted AISHA platformě.

---

## Přehled

AISHA používá **self-hosted Supabase (GoTrue)** pro autentizaci. OAuth providery (Google, Apple, Keycloak) jsou již nakonfigurovány v `docker-compose.coolify.yml` — stačí dodat **Client ID** a **Client Secret** přes environment proměnné.

### Architektura OAuth flow

```
Uživatel → klikne "Přihlásit se přes Google/Apple"
         → frontend zavolá supabase.auth.signInWithOAuth({ provider })
         → GoTrue přesměruje na poskytovatele (Google/Apple)
         → uživatel se přihlásí u poskytovatele
         → poskytovatel přesměruje zpět na Callback URL
         → GoTrue zpracuje token, vytvoří/spojí uživatele
         → přesměruje na frontend (SITE_URL)
```

### Callback URL (společná pro všechny providery)

```
https://<API_DOMAIN>/auth/v1/callback
```

Příklad pro produkci: `https://api.example.com/auth/v1/callback`

---

## 1. Google OAuth

### Krok 1: Vytvoření OAuth 2.0 Client

1. Otevři [Google Cloud Console](https://console.cloud.google.com/)
2. Vyber nebo vytvoř projekt
3. Naviguj: **APIs & Services → Credentials**
4. Klikni **+ CREATE CREDENTIALS → OAuth client ID**
5. Pokud nemáš nastavený **OAuth consent screen**, vytvoř ho:
   - User Type: **External** (nebo Internal pro Google Workspace)
   - App name: `AISHA Dirigent` — **musí odpovídat názvu na homepage!**
   - User support email: tvůj email
   - Authorized domains: tvá doména (např. `example.com`)
   - Developer contact: tvůj email
6. Zpět na **Credentials → + CREATE CREDENTIALS → OAuth client ID**:
   - Application type: **Web application**
   - Name: `AISHA Dirigent Supabase Auth`
   - Authorized redirect URIs: **přidej:**
     ```
     https://<API_DOMAIN>/auth/v1/callback
     ```
     Příklad: `https://api.example.com/auth/v1/callback`
7. Klikni **CREATE** — zobrazí se **Client ID** a **Client secret**

### Krok 2: Nastavení proměnných

V Coolify UI (nebo `.env`) nastav:

| Proměnná | Hodnota |
|----------|---------|
| `ENABLE_GOOGLE_OAUTH` | `true` |
| `OAUTH_GOOGLE_CLIENT_ID` | Client ID z Google Console (např. `123456789-xxx.apps.googleusercontent.com`) |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Client secret z Google Console |

### Krok 3: (Volitelné) OAuth consent screen — produkční stav

Pro development Google povoluje až 100 test uživatelů. Pro produkci:

1. **APIs & Services → OAuth consent screen**
2. Klikni **PUBLISH APP**
3. Pokud požaduješ citlivé scopes, Google vyžaduje verifikaci (může trvat týdny)
4. Pro základní přihlášení (email + profil) verifikace většinou není nutná

> **Tip:** Google vyžaduje, aby název aplikace na consent screen (**App name**) odpovídal názvu viditelném na homepage. Stránka zobrazuje „AISHA Dirigent by AISHA" — nastav stejný název i v consent screen.

---

## 2. Apple Sign-In

> Apple Sign-In vyžaduje placený Apple Developer účet ($99/rok).

### Krok 1: Vytvoření App ID

1. Otevři [Apple Developer Console](https://developer.apple.com/account)
2. Naviguj: **Certificates, Identifiers & Profiles → Identifiers**
3. Klikni **+** → vyber **App IDs** → **App**
4. Vyplň:
   - Description: `AISHA Dirigent`
   - Bundle ID: `com.example.dirigent` (nebo jakýkoliv unikátní identifikátor)
5. V **Capabilities** zaškrtni **Sign in with Apple**
6. Klikni **Continue → Register**

### Krok 2: Vytvoření Services ID (= Client ID)

1. **Identifiers → +** → vyber **Services IDs**
2. Vyplň:
   - Description: `AISHA Dirigent Web Login`
   - Identifier: `com.example.dirigent.web` (toto bude tvůj **Client ID**)
3. Klikni **Continue → Register**
4. Otevři právě vytvořený Services ID
5. Zaškrtni **Sign in with Apple** → klikni **Configure**:
   - Primary App ID: vyber App ID z kroku 1
   - Domains: tvá doména (např. `example.com`)
   - Return URLs: **přidej:**
     ```
     https://<API_DOMAIN>/auth/v1/callback
     ```
     Příklad: `https://api.example.com/auth/v1/callback`
6. Klikni **Save → Continue → Save**

### Krok 3: Vytvoření klíče (pro generování Client Secret)

1. **Keys → +**
2. Name: `AISHA Dirigent Auth Key`
3. Zaškrtni **Sign in with Apple** → **Configure** → vyber Primary App ID
4. Klikni **Continue → Register**
5. **Stáhni klíč** (`.p8` soubor) — **toto je jediná šance ho stáhnout!**
6. Zapiš si **Key ID** (zobrazí se na stránce)
7. Zapiš si **Team ID** — najdeš ho v pravém horním rohu Apple Developer nebo v **Membership**

### Krok 4: Generování Client Secret (JWT)

Apple nepoužívá statický secret — vyžaduje **JWT podepsaný tvým klíčem**. Tento JWT je platný max 6 měsíců a musí se pravidelně obnovovat.

**Použij Node.js skript** (k dispozici v repozitáři):

```bash
node scripts/gen-apple-secret.mjs \
  --key AuthKey_XXXXXXXXXX.p8 \
  --team-id XXXXXXXXXX \
  --client-id com.example.dirigent.web \
  --key-id XXXXXXXXXX
```

Nebo manuálně:

```bash
npm install jsonwebtoken

node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');

const key      = fs.readFileSync('AuthKey_XXXXXXXXXX.p8');
const teamId   = 'XXXXXXXXXX';           // Team ID z Apple Developer → Membership
const clientId = 'com.example.dirigent.web'; // Services ID z kroku 2
const keyId    = 'XXXXXXXXXX';           // Key ID z kroku 3

const token = jwt.sign({}, key, {
  algorithm: 'ES256',
  expiresIn: '180d',
  audience: 'https://appleid.apple.com',
  issuer: teamId,
  subject: clientId,
  keyid: keyId,
});
console.log(token);
"
```

### Krok 5: Nastavení proměnných

| Proměnná | Hodnota |
|----------|---------|
| `ENABLE_APPLE_OAUTH` | `true` |
| `OAUTH_APPLE_CLIENT_ID` | Services ID (např. `com.example.dirigent.web`) |
| `OAUTH_APPLE_CLIENT_SECRET` | Vygenerovaný JWT z kroku 4 |

> **Pozor:** Apple secret (JWT) expiruje max za 6 měsíců. Nastav si reminder pro obnovu!

---

## 3. Deploy

### Coolify

1. Otevři Coolify UI (`https://<coolify-host>`) → Projekt → Environment Variables
2. Nastav proměnné z tabulek výše (Google a/nebo Apple)
3. Redeployni stack — klikni **Redeploy** nebo přes API:
   ```bash
   curl -sS "https://<coolify-host>/api/v1/deploy?uuid=<app-uuid>&force=true" \
     -H "Authorization: Bearer $COOLIFY_TOKEN"
   ```

### Docker Compose (lokální)

Nastav proměnné v `.env` souboru a restartuj:

```bash
# .env
ENABLE_GOOGLE_OAUTH=true
OAUTH_GOOGLE_CLIENT_ID=123456789-xxx.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-xxx

ENABLE_APPLE_OAUTH=true
OAUTH_APPLE_CLIENT_ID=com.example.dirigent.web
OAUTH_APPLE_CLIENT_SECRET=eyJhbGciOi...

# Restart pouze auth služby
docker compose restart auth
```

---

## 4. Ověření

### Kontrola GoTrue konfigurace

```bash
curl -sS https://<API_DOMAIN>/auth/v1/settings | python3 -m json.tool
```

Výstup by měl obsahovat:

```json
{
  "external": {
    "google": true,
    "apple": true,
    ...
  }
}
```

### Test OAuth flow

1. Otevři aplikaci v prohlížeči
2. Na přihlašovací stránce klikni na tlačítko Google / Apple
3. Dokončí se OAuth flow → přesměrování zpět do aplikace
4. Ověř v DB:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A << 'PSQL_EOF'
SELECT id, email, raw_app_meta_data->>'provider' AS provider
FROM auth.users
WHERE raw_app_meta_data->>'provider' IN ('google', 'apple')
ORDER BY created_at DESC LIMIT 5;
PSQL_EOF
```

---

## 5. Troubleshooting

| Problém | Příčina | Řešení |
|---------|---------|--------|
| Redirect mismatch | Callback URL neodpovídá | Zkontroluj že `https://<API_DOMAIN>/auth/v1/callback` je přesně v nastavení providera |
| 400 po přesměrování | Client ID/Secret chybí nebo špatný | Zkontroluj env proměnné, redeployni |
| Apple `invalid_client` | Secret (JWT) expiroval | Vygeneruj nový JWT (max 180 dní) |
| Google `access_denied` | App není publikovaná + uživatel není tester | Publikuj app nebo přidej uživatele do test users |
| Google: "app name doesn't match" | Název v consent screen ≠ název na homepage | Nastav App name v Google Console na `AISHA Dirigent` |
| Uživatel se nepřesměruje zpět | `GOTRUE_SITE_URL` špatně | Zkontroluj `APP_DOMAIN` env proměnnou |
| OAuth funguje ale uživatel nemá roli | Automatické přiřazení rolí chybí | Nastav trigger/hook pro nové uživatele |

---

## 6. Environment proměnné — přehled

| Proměnná | Výchozí | Popis |
|----------|---------|-------|
| `ENABLE_GOOGLE_OAUTH` | `true` | Zapnout Google přihlášení |
| `OAUTH_GOOGLE_CLIENT_ID` | _(prázdné)_ | Google OAuth Client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | _(prázdné)_ | Google OAuth Client Secret |
| `ENABLE_APPLE_OAUTH` | `true` | Zapnout Apple přihlášení |
| `OAUTH_APPLE_CLIENT_ID` | _(prázdné)_ | Apple Services ID |
| `OAUTH_APPLE_CLIENT_SECRET` | _(prázdné)_ | Apple JWT secret (obnovovat každých 180 dní) |
| `APP_DOMAIN` | `web.example.com` | Doména frontendu (redirect po přihlášení) |
| `API_DOMAIN` | `api.example.com` | Doména API (callback URL) |
| `ADDITIONAL_REDIRECT_URLS` | _(prázdné)_ | Další povolené redirect URLs (čárkou oddělené) |

> **Pozor:** Pokud `OAUTH_*_CLIENT_ID` je prázdné, provider je sice "enabled" ale GoTrue vrátí chybu při pokusu o přihlášení. Vždy nastav oba — Client ID i Secret — nebo nastav `ENABLE_*_OAUTH=false`.

---

## Authentication flow `aisha first broker login`

Defined in [`keycloak/aisha-realm.json`](../../keycloak/aisha-realm.json). Its
`description` field is deliberately terse — Keycloak stores it in
`AUTHENTICATION_FLOW.DESCRIPTION`, a `varchar(255)`, and an over-length value
does not truncate: the realm import fails and **Keycloak never starts**. The full
rationale lives here instead.

**What it does (since 2026-09-27).** An unknown e-mail creates a user. An
e-mail that belongs to an EXISTING account is linked only after the owner
confirms the link (`idp-confirm-link`) and proves ownership — an e-mail link
(`idp-email-verification`) OR re-authentication with the account's password
(`idp-username-password-form`, plus OTP when the account has it). There is no
silent linking.

**Why the auto-link is gone.** Until 2026-09-27 the flow ended in `idp-auto-link`.
Keycloak 26.0.8 `IdpAutoLinkAuthenticator` sets the existing user and succeeds
immediately — it checks neither `trustEmail` nor `email_verified`. Anyone who can
obtain a Google/Apple identity carrying a victim's address (e.g. the admin of the
victim's e-mail domain, who can create such an account) was linked straight into
the victim's account. Measured 2026-09-27 (read-only, Keycloak DB): Google and
Apple enabled with `trustEmail=true` and `idp-auto-link` live in the realm on four
measured instances.

**How running realms get it.** The realm template reaches Keycloak only through
an import into an EMPTY realm, so a template change alone never reaches a running
realm. `keycloak/reconcile-realm-clients.sh` (runs after every Keycloak start)
replaces `idp-auto-link` with the verification subflows, building them from
scratch and removing the auto-link only once verification is in place; it then
re-reads the flow and fails loudly if the auto-link is still there. Every step is
written with an EXPLICIT priority: in Keycloak 26.0.8 `PUT …/executions` without
`priority` resets it to 0 and moves the step to the top of the flow (measured on
a throwaway 26.0.8 container) — the verification subflow would then run before
`idp-create-user-if-unique` and a brand-new user would be asked to link someone
else's account. The reconcile checks that `idp-create-user-if-unique` has a
strictly lowest priority and repairs it otherwise. Gates:
`src/tests/gates/prvni-prihlaseni-bez-automatickeho-propojeni.gate.test.ts`
(template properties, light lane) and
`src/tests/gates/smir-prvniho-prihlaseni-dorovna-realm.gate.test.ts` (the reconcile
block against a Keycloak 26.0.8 model: realm before the fix, idempotence, broken
order, and a crash at every write followed by the next start — heavy lane).

**Without SMTP (every instance today).** The e-mail branch returns `attempted`
(Keycloak `IdpEmailVerificationAuthenticator`), so the flow falls through to
re-authentication: the owner links the account by entering its password. An
account WITHOUT a password therefore cannot link itself on first use — it waits
for approval in administration (step B, review queue like twins/ingest).
Measured 2026-09-27 (accounts without service accounts / without password AND
without a link / already linked): on the four measured instances every account was
in the first group — nobody is stranded today; accounts already linked keep their link.
The doctor (phase K) reports social login without SMTP as a WARN.

**`trustEmail`.** Left `true`. Linking no longer depends on it
(`IdpEmailVerificationAuthenticator` in 26.0.8 does not read it); switching it
off would only force e-mail verification of NEW social users, which without SMTP
would lock them out.

**Operational note (2026-07-19).** A 454-character description in this flow took
the entire stack down: Keycloak crash-looped on `value too long for type
character varying(255)`, so no OIDC, so NetBird could not enrol, so the mesh
never came up and `api`/`mcp` served 502 — while Coolify still reported the app
healthy. `src/tests/gates/keycloak-realm-column-limits.gate.test.ts` now pins the
column limits so an over-length authored field fails in CI instead of at boot.

---

## Reference

- [Supabase Auth — Social Login](https://supabase.com/docs/guides/auth/social-login)
- [Google OAuth 2.0 Setup](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign in with Apple](https://developer.apple.com/sign-in-with-apple/)
- [GoTrue External Provider Config](https://github.com/supabase/gotrue#external-authentication-providers)
- Frontend hook: [`src/hooks/useAuthActions.ts`](../../src/hooks/useAuthActions.ts) — `useOAuthLogin()`
- Docker compose config: [`docker-compose.coolify.yml`](../../docker-compose.coolify.yml) — GoTrue service (řádky 130–145)
- Env template: [`.env.coolify.example`](../../.env.coolify.example) — sekce Google/Apple OAuth
