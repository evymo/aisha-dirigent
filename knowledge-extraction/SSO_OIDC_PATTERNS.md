# SSO & OIDC Integration Patterns — AISHA

> Produkční znalostní báze pro SSO/OIDC integraci na AISHA platformě.
> Zahrnuje: Keycloak setup, OAuth2 Proxy, GoTrue external providers, Langfuse/Appsmith OIDC.
> Aktualizováno: 2026-04-10

---

## Architektura

Keycloak je **centrální OIDC provider** pro celou platformu. GoTrue (Supabase Auth) je primární auth layer pro frontend aplikaci.

```
                    ┌─────────────────┐
                    │    Keycloak     │
                    │  auth.aisha.guru     │
                    │  realm: evymo   │
                    └────────┬────────┘
                             │ OIDC
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ GoTrue  │         │OAuth2Prx│         │  OIDC   │
   │ (Auth)  │         │(Studio) │         │(Langfuse│
   │         │         │(n8n)    │         │Appsmith)│
   └────┬────┘         └────┬────┘         └─────────┘
        │                    │
   ┌────▼────┐         ┌────▼────┐
   │Frontend │         │ Studio  │
   │  App    │         │  n8n UI │
   └─────────┘         └─────────┘
```

### Strategy: BRIDGE

Keycloak slouží jako OIDC provider pro GoTrue. **NENAHRAZUJE GoTrue** — GoTrue zůstává primární auth layer.

- Frontend volá `supabase.auth.signInWithOAuth({ provider: 'keycloak' })`
- GoTrue redirectuje na Keycloak → user se přihlásí → callback zpět na GoTrue
- GoTrue vytvoří/aktualizuje `auth.users` záznam + vrátí JWT

---

## Keycloak — Konfigurace

### Realm: evymo

**SoT:** `keycloak/evymo-realm.json` (auto-import při prvním startu s prázdnou DB)

**Import behavior (KC 26.x):**
- `--import-realm` importuje **pouze při prvním startu** (prázdná keycloak-db)
- Po restartu s existující DB se realm JSON **ignoruje**
- Změny produkčního realmu musí jít přes **KC Admin API** nebo Admin UI
- Po smazání `keycloak-db-data` volume se realm znovu importuje z JSON

### Klienti v realm `evymo`

| Client ID | Služba | Flow | PKCE | Redirect URI | Skupiny |
|-----------|--------|------|------|-------------|---------|
| `aisha-app` | GoTrue → Frontend | Authorization Code | ❌ | `https://api.aisha.guru/auth/v1/callback` | — |
| `supabase-studio` | OAuth2 Proxy → Studio | Authorization Code | ❌ | `https://db.aisha.guru/oauth2/callback` | `studio_access` |
| `n8n` | OAuth2 Proxy → n8n | Authorization Code | ❌ | `https://n8n.aisha.guru/oauth2/callback` | `n8n_access` |
| `langfuse` | Langfuse built-in OIDC | Authorization Code | ✅ | `https://langfuse.aisha.guru/api/auth/callback/custom` | — |
| `appsmith` | Appsmith built-in OIDC | Authorization Code | ✅ | `https://appsmith.aisha.guru/login/oauth2/code/oidc` | — |

### PKCE — DŮLEŽITÉ

- **GoTrue** (evymo-app): PKCE **VYPNUTO** (`pkce.code.challenge.method: ""`) — GoTrue external providers **nepodporují PKCE**
- **OAuth2 Proxy** (Studio, n8n): PKCE **VYPNUTO** — OAuth2 Proxy v7.x PKCE nepodporuje
- **Langfuse, Appsmith**: PKCE **ZAPNUTO** — nativní OIDC podpora

V Keycloak Admin UI: Client → Advanced → Proof Key for Code Exchange → `""` (prázdné = off)

### Email mapper — KRITICKÉ

GoTrue vyžaduje `email` claim v OIDC token. Keycloak MUSÍ mít správně nakonfigurovaný mapper:

```
Mapper Type: oidc-usermodel-property-mapper (NE attribute-mapper!)
Token claim: email
User property: email
```

Pokud je mapper špatný → GoTrue vytvoří uživatele bez emailu → broken auth flow.

### Skupiny (Groups) pro přístup

| Skupina | Služby | Účel |
|---------|--------|------|
| `studio_access` | OAuth2 Proxy → Studio | Přístup k Supabase Studio |
| `n8n_access` | OAuth2 Proxy → n8n | Přístup k n8n přes SSO |

Uživatel MUSÍ být členem příslušné skupiny aby OAuth2 Proxy propustil request.

---

## GoTrue — External Provider Setup

### Env vars (docker-compose.coolify.yml, auth service)

```yaml
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED: "true"
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID: "aisha-app"
GOTRUE_EXTERNAL_KEYCLOAK_SECRET: "${KEYCLOAK_CLIENT_SECRET}"
GOTRUE_EXTERNAL_KEYCLOAK_URL: "https://auth.aisha.guru/realms/aisha"
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI: ""
```

**`REDIRECT_URI`:** Prázdné = GoTrue si ho odvodí automaticky z `API_EXTERNAL_URL + /auth/v1/callback`.

### Startup ordering

GoTrue se na Keycloak napojuje přes **veřejnou doménu** (`https://auth.aisha.guru/realms/aisha`), ne interní síť. KC nemusí běžet aby GoTrue nastartoval — GoTrue jen zaregistruje provider, OIDC discovery proběhne až při first login.

---

## OAuth2 Proxy — Pattern

### Docker Compose služba

```yaml
service-auth:
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.8.2
  container_name: evymo-{service}-auth
  restart: unless-stopped
  environment:
    OAUTH2_PROXY_PROVIDER: keycloak-oidc
    OAUTH2_PROXY_OIDC_ISSUER_URL: "https://auth.aisha.guru/realms/aisha"
    OAUTH2_PROXY_CLIENT_ID: "${CLIENT_ID}"
    OAUTH2_PROXY_CLIENT_SECRET: "${CLIENT_SECRET}"
    OAUTH2_PROXY_REDIRECT_URL: "https://${DOMAIN}/oauth2/callback"
    OAUTH2_PROXY_COOKIE_SECRET: "${COOKIE_SECRET}"
    OAUTH2_PROXY_UPSTREAMS: "http://{upstream-service}:{port}"
    OAUTH2_PROXY_EMAIL_DOMAINS: "*"
    OAUTH2_PROXY_ALLOWED_GROUPS: "${ALLOWED_GROUPS}"
    OAUTH2_PROXY_COOKIE_SECURE: "true"
    OAUTH2_PROXY_HTTP_ADDRESS: "0.0.0.0:4180"
    OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/healthz"
    OAUTH2_PROXY_PASS_ACCESS_TOKEN: "true"
    OAUTH2_PROXY_PASS_AUTHORIZATION_HEADER: "true"
    OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
    OAUTH2_PROXY_REVERSE_PROXY: "true"
  expose:
    - "4180"
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:4180/ping || exit 1"]
    interval: 15s
    timeout: 5s
    start_period: 10s
    retries: 5
  networks:
    - internal
    - coolify
  labels:
    - "coolify.managed=true"
    - "traefik.docker.network=coolify"
```

### Cookie secret generování

```bash
python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

32 bytů, base64 encoded. MUSÍ být stabilní (ne rotovat při restartu) — jinak se rozbijí všechny sessions.

### Skip auth routes

```
# n8n webhooky (musí být přístupné bez SSO pro workflow triggery)
OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/webhook/.*,^/webhook-test/.*,^/healthz"

# Studio (vše chráněné)
OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/healthz"
```

---

## Langfuse OIDC

```env
AUTH_CUSTOM_CLIENT_ID=langfuse
AUTH_CUSTOM_CLIENT_SECRET=${SECRET}
AUTH_CUSTOM_ISSUER=https://auth.aisha.guru/realms/aisha
AUTH_CUSTOM_NAME="AISHA SSO"
```

Langfuse v3.x má nativní OIDC podporu — nepotřebuje OAuth2 Proxy.

---

## Appsmith OIDC

Konfigurace přes Appsmith Admin UI (Settings → Authentication → OpenID Connect):
- Authorization URL: `https://auth.aisha.guru/realms/aisha/protocol/openid-connect/auth`
- Token URL: `https://auth.aisha.guru/realms/aisha/protocol/openid-connect/token`
- UserInfo URL: `https://auth.aisha.guru/realms/aisha/protocol/openid-connect/userinfo`
- Client ID: `appsmith`
- Client Secret: `${SECRET}`

---

## Troubleshooting

### "Invalid redirect_uri" od Keycloak

**Příčina:** Redirect URI v Keycloak klientovi neodpovídá tomu co posílá služba.

**Fix:**
1. KC Admin → Clients → {client_id} → Valid Redirect URIs
2. Přidej přesný callback URL: `https://domain.id3a.cz/oauth2/callback`
3. Pro development: `http://localhost:*/oauth2/callback`

### "User not in allowed group" (OAuth2 Proxy 403)

**Příčina:** Uživatel není členem skupiny specifikované v `OAUTH2_PROXY_ALLOWED_GROUPS`.

**Fix:**
1. KC Admin → Users → {user} → Groups → Přidat do skupiny
2. Ověř že `group-membership` mapper existuje v klientu (Client Scopes → {client} → Mappers)

### GoTrue callback loop (redirect loop)

**Příčina:** GoTrue `SITE_URL` neodpovídá frontend URL, nebo `ADDITIONAL_REDIRECT_URLS` neobsahuje callback URL.

**Fix:**
```env
GOTRUE_SITE_URL: "https://web.aisha.guru"
GOTRUE_URI_ALLOW_LIST: "https://web.aisha.guru/auth/callback"
```

### OAuth2 Proxy 500 na /oauth2/callback

**Příčina:** Špatný `OAUTH2_PROXY_COOKIE_SECRET` (délka, formát) nebo špatný `CLIENT_SECRET`.

**Diagnostika:** Logy OAuth2 Proxy kontejneru: `docker logs evymo-{service}-auth --tail 50`

---

## Anti-patterns

1. **NIKDY nesdílej client secret** mezi klienty — každá služba má vlastní Keycloak client
2. **NIKDY nepoužívej PKCE s GoTrue** external providers — GoTrue to nepodporuje
3. **NIKDY nenastavuj `OAUTH2_PROXY_COOKIE_SECURE=false`** v produkci — cookies musí být secure
4. **NIKDY neupravuj realm JSON pro produkční změny** — JSON se importuje jen při first boot, použij Admin API
5. **Nepoužívej `attribute-mapper`** pro email v Keycloak — musí být `property-mapper`
