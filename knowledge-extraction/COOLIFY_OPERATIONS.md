# Coolify Operations — Provozní znalostní báze

> Produkční knowhow pro správu AISHA platformy na Coolify v4.x.
> Zahrnuje: API patterns, domain management, stack lifecycle, troubleshooting.
> Aktualizováno: 2026-04-10

---

## Architektura deploymentu

### 4 stacky na Coolify

| Stack | UUID | Compose | Služby | Doména |
|-------|------|---------|--------|--------|
| **Core** | `js80o0ccc0888o0wwkc80ss8` | `docker-compose.coolify.yml` | 18 (DB, Auth, Kong, Realtime…) | web.aisha.guru, api.aisha.guru, db.aisha.guru, auth.aisha.guru |
| **Web** | (prebuilt) | `docker-compose.coolify-prebuilt.yml` | 2 (migrate + web) | web.aisha.guru |
| **n8n** | `u00woowgoc8owwww8kcs84g0` | `docker-compose.coolify-n8n.yml` | 6 (n8n, worker, pg, redis, task-runners, n8n-auth) | n8n.aisha.guru, n8n.aisha.guru |
| **Langfuse** | `i8gkg8c4k4gkgwc444s8cww0` | `docker-compose.coolify-langfuse.yml` | 5+ (ClickHouse, Redis, MinIO…) | langfuse.aisha.guru |
| **Admin** | `vkg8gw4ggkc88wo84og4o8kc` | `docker-compose.coolify-admin.yml` | 2+ (NocoDB, Appsmith) | nocodb.aisha.guru, appsmith.aisha.guru |

### Domény — kompletní mapa

| Doména | Stack | Služba | Port | Účel |
|--------|-------|--------|------|------|
| web.aisha.guru | Core/Web | web | 80 | Frontend SPA |
| api.aisha.guru | Core | kong | 8000 | API Gateway (Kong) |
| db.aisha.guru | Core | studio-auth (OAuth2 Proxy) | 4180 | Supabase Studio (SSO-chráněné) |
| auth.aisha.guru | Core | keycloak | 8080 | Keycloak Admin + OIDC |
| n8n.aisha.guru | n8n | n8n | 5678 | n8n UI (přímý přístup) |
| n8n.aisha.guru | n8n | n8n-auth (OAuth2 Proxy) | 4180 | n8n SSO (přes Keycloak) |
| langfuse.aisha.guru | Langfuse | langfuse | 3000 | AI Observability |
| nocodb.aisha.guru | Admin | nocodb | 8080 | NocoDB admin |
| appsmith.aisha.guru | Admin | appsmith | 80 | Appsmith admin |

---

## Coolify API — ověřené vzory

### Autentizace

```bash
COOLIFY_API_TOKEN="3|kPH9..." # z frontend.id3a.cz → Settings → API Tokens
AUTH="Authorization: Bearer $COOLIFY_API_TOKEN"
BASE="https://frontend.id3a.cz/api/v1"
```

### Status stacku

```bash
curl -s "$BASE/applications/{uuid}" -H "$AUTH" | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))"
```

Možné stavy: `running:healthy`, `running:unhealthy`, `stopped`, `exited`

### Restart / Redeploy

```bash
# Restart → FULL redeploy (build + remove + recreate ALL containers)
curl -s -X POST "$BASE/applications/{uuid}/restart" -H "$AUTH"
# → {"deployment_uuid": "..."}
```

**POZOR:** Restart u docker-compose stacků = FULL redeploy. Zastaví a smaže VŠECHNY kontejnery ve stacku, pak je znovu vytvoří. Výpadek ~2-3 minuty.

### Deploy log

```bash
curl -s "$BASE/deployments/{deployment_uuid}" -H "$AUTH"
# → {"status", "log", "created_at", ...}
```

### Aktualizace domén (docker_compose_domains)

```bash
# GET aktuální domény
curl -s "$BASE/applications/{uuid}" -H "$AUTH" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('docker_compose_domains','{}'), indent=2))"

# SET domény — SPRÁVNÝ formát (musí být array s "name" field!)
curl -s -X PATCH "$BASE/applications/{uuid}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "docker_compose_domains": [
      {"name": "service-name", "domain": "https://domain.id3a.cz"},
      {"name": "another-service", "domain": "https://another.id3a.cz:PORT"}
    ]
  }'
```

**KRITICKÉ:** Format je array of objects s `"name"` (ne `"service"`). Portované služby vyžadují port v URL.

### API endpoints — dostupné vs. nedostupné

| Endpoint | Funguje pro compose? | Poznámka |
|----------|---------------------|----------|
| `GET /applications/{uuid}` | ✅ | Status, config, compose raw |
| `POST /applications/{uuid}/restart` | ✅ | Full redeploy |
| `PATCH /applications/{uuid}` | ✅ | Update domains, env vars |
| `GET /applications/{uuid}/envs` | ✅ | List env vars |
| `GET /deployments/{uuid}` | ✅ | Deploy log + status |
| `POST /deploy?uuid=...` | ⚠️ | Webhook trigger, nemusí fungovat přes API |
| `POST /applications/{uuid}/rebuild` | ❌ 404 | Neexistuje pro compose |
| `POST /applications/{uuid}/start` | ❌ 404 | Neexistuje |
| `GET /applications/{uuid}/status` | ❌ 404 | Použij GET /applications/{uuid} |
| `GET /applications/{uuid}/containers` | ❌ 404 | Neexistuje |

---

## Troubleshooting

### `running:unhealthy` — kosmětický stav

**Příčina:** Coolify Sentinel kontroluje Docker healthcheck **VŠECH** kontejnerů ve stacku. Pokud jakýkoli kontejner je `exited` nebo `unhealthy`, celý stack = `running:unhealthy`.

**Typické zdroje:**
1. **One-shot kontejnery** (restart: "no"): `functions-init`, `migrate` — po dokončení exit 0 → Coolify vidí jako "crash"
2. **Logflare/analytics** — periodicky failuje healthcheck (Logflare startup race condition)
3. **Task runners** (n8n) — worker kontejnery s krátkou životností

**Řešení:**
1. Init kontejnery: `healthcheck: disable: true`
2. Analytics: `healthcheck: disable: true` (pokud Logflare nestabilní)
3. Přijmout jako kosmetický stav — ověřit funkčnost přes HTTP checks

**Diagnostika:**
```bash
# Ověření přes HTTP (ne Coolify status)
for domain in web.aisha.guru api.aisha.guru auth.aisha.guru; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://$domain/")
  printf "%-40s %s\n" "$domain" "$code"
done
```

### n8n 503 — špatné domain mapping

**Příčina:** Coolify auto-generuje domain pro service: `{svc}-{uuid}.id3a.cz`. Pokud někdo překonfiguruje domény, vlastní domain zmizí.

**Diagnostika:**
```bash
curl -s "$BASE/applications/{uuid}" -H "$AUTH" | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('docker_compose_domains'))"
```

**Fix:** PATCH s korektními doménami (viz API vzory výše), pak restart.

### OAuth2 Proxy 503 — upstream nedostupný

**Symptom:** SSO-chráněná služba (Studio, n8n) vrací 503 po přihlášení.

**Příčiny:**
1. Upstream service healthcheck failing → Traefik ho přeskočí
2. OAuth2 Proxy `--upstream` směřuje na špatný host/port
3. Traefik vybral špatnou síť (chybí `traefik.docker.network=coolify` label)

**Fix:**
1. Ověř healthcheck upstream služby
2. Zkontroluj `OAUTH2_PROXY_UPSTREAMS` env var
3. Přidej missing label `traefik.docker.network=coolify`

---

## SSO / OIDC Integration

### Keycloak jako centrální OIDC provider

```
┌─────────────┐     OIDC      ┌────────────┐
│  Keycloak   │◄──────────────│  GoTrue    │
│  (kc.id3a)  │               │  (Auth)    │
│             │     OIDC      │            │
│             │◄──────────────│ OAuth2Proxy│
│             │               │ (Studio)   │
│             │     OIDC      │            │
│             │◄──────────────│ OAuth2Proxy│
│             │               │ (n8n)      │
│             │     OIDC      │            │
│             │◄──────────────│ Langfuse   │
│             │               │            │
│             │     OIDC      │            │
│             │◄──────────────│ Appsmith   │
└─────────────┘               └────────────┘
```

### Keycloak klienti (realm: evymo)

| Client ID | Služba | Typ | PKCE |
|-----------|--------|-----|------|
| `aisha-app` | GoTrue (App login) | Confidential | ❌ (GoTrue nepodporuje) |
| `supabase-studio` | OAuth2 Proxy → Studio | Confidential | ❌ |
| `n8n` | OAuth2 Proxy → n8n | Confidential | ❌ |
| `langfuse` | Langfuse OIDC | Confidential | ✅ |
| `appsmith` | Appsmith OIDC | Confidential | ✅ |

### OAuth2 Proxy vzor (Studio, n8n)

```yaml
oauth2-proxy:
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.8.2
  environment:
    OAUTH2_PROXY_PROVIDER: keycloak-oidc
    OAUTH2_PROXY_OIDC_ISSUER_URL: https://auth.aisha.guru/realms/aisha
    OAUTH2_PROXY_CLIENT_ID: ${CLIENT_ID}
    OAUTH2_PROXY_CLIENT_SECRET: ${CLIENT_SECRET}
    OAUTH2_PROXY_REDIRECT_URL: https://${DOMAIN}/oauth2/callback
    OAUTH2_PROXY_COOKIE_SECRET: ${COOKIE_SECRET}  # 32B base64
    OAUTH2_PROXY_UPSTREAMS: http://upstream-service:PORT
    OAUTH2_PROXY_EMAIL_DOMAINS: "*"
    OAUTH2_PROXY_ALLOWED_GROUPS: ${ALLOWED_GROUPS}
    OAUTH2_PROXY_COOKIE_SECURE: "true"
    OAUTH2_PROXY_HTTP_ADDRESS: "0.0.0.0:4180"
    OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/healthz"
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:4180/ping || exit 1"]
    interval: 15s
    timeout: 5s
    start_period: 10s
    retries: 5
```

### Generování cookie secret

```bash
python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

---

## Provozní checklist po deploymentu

### Quick health check (< 30s)

```bash
# Všechny endpointy najednou
for u in \
  "web.aisha.guru|https://web.aisha.guru/" \
  "api.aisha.guru|https://api.aisha.guru/" \
  "db.aisha.guru|https://db.aisha.guru/ping" \
  "auth.aisha.guru|https://auth.aisha.guru/realms/aisha/.well-known/openid-configuration" \
  "n8n.aisha.guru|https://n8n.aisha.guru/" \
  "n8n.aisha.guru|https://n8n.aisha.guru/" \
  "langfuse.aisha.guru|https://langfuse.aisha.guru/" \
  "nocodb.aisha.guru|https://nocodb.aisha.guru/" \
  "appsmith.aisha.guru|https://appsmith.aisha.guru/"
do
  domain="${u%%|*}"; url="${u##*|}"
  code=$(curl -sk -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  printf "%-42s %s\n" "$domain" "$code"
done
```

### Očekávané HTTP kódy

| Doména | Očekávaný kód | Význam |
|--------|---------------|--------|
| web.aisha.guru | 200 | Frontend SPA načteno |
| api.aisha.guru | 404 | Kong root (žádná route) — expected |
| db.aisha.guru | 200/302 | Studio UI nebo SSO redirect |
| auth.aisha.guru | 200 | Keycloak OIDC discovery |
| n8n.aisha.guru | 200 | n8n UI |
| n8n.aisha.guru | 302 | SSO redirect na Keycloak |
| langfuse.aisha.guru | 200 | Langfuse UI |
| nocodb.aisha.guru | 302 | NocoDB login redirect |
| appsmith.aisha.guru | 302 | Appsmith login redirect |

---

## Anti-patterns

1. **NIKDY nepoužívej `studio.id3a.cz`** — správná doména je `db.aisha.guru`
2. **NIKDY nerestart Core stack bez důvodu** — full redeploy = ~3min výpadek VŠECH služeb
3. **NIKDY neměň docker_compose_domains přes Coolify UI** — změny se ztratí při redeployi z Forgeji
4. **Coolify `running:unhealthy` ≠ nefunkční** — vždy ověř přes HTTP, ne Coolify status
5. **Coolify restart ≠ graceful restart** — zastaví a smaže VŠECHNY kontejnery, pak znovu vytvoří
