# V2 Migration Cutover Runbook
# =============================================================================
# Tento runbook dokumentuje kompletní postup migrace z Supabase stacku (v1)
# na PG17 + Keycloak + Fastify stack (v2) v Coolify produkci.
#
# Prerekvizity:
#   - Keycloak stack deployed a healthy (docker-compose.coolify-keycloak.yml)
#   - Všechny Dockerfile.* builditelné na produkčním serveru
#   - Env vars nastaveny v Coolify pro v2 stack
#   - Záloha v1 databáze a storage provedena
# =============================================================================

## Pořadí kroků

### 1. Záloha v1 stacku

```bash
# Záloha PG (v1 — Supabase DB):
docker exec aisha-db pg_dumpall -U supabase_admin | gzip > backup-v1-$(date +%Y%m%d).sql.gz

# Záloha storage volumes:
docker run --rm -v evymo_storage-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-v1-storage-$(date +%Y%m%d).tar.gz /data

# Záloha vault secrets (pro reference):
docker exec aisha-db psql -U supabase_admin -d postgres -t -A \
  -c "SELECT name, description FROM vault.decrypted_secrets ORDER BY name" \
  > backup-v1-vault-names.txt
```

### 2. Deploy v2 stack (paralelně s v1 — jiný port)

V Coolify:
1. Vytvořit nový Docker Compose stack
2. Nahrát `docker-compose.coolify-v2.yml`
3. Nastavit env vars (viz sekce "Env vars" níže)
4. **DŮLEŽITÉ**: Zatím NENASTAVOVAT domain labels — v2 běží paralelně bez Traefiku
5. Deploy — počkat na healthy status všech services

### 3. Data migrace

```bash
# 3a. Import KC users z GoTrue → Keycloak
npx tsx scripts/kc-user-import.ts \
  --pg-url="postgresql://supabase_admin:$PG_PW@old-db:5432/postgres" \
  --kc-url="http://evymo-keycloak:8080" \
  --kc-realm=evymo \
  --kc-admin=admin \
  --kc-password="$KC_ADMIN_PW"

# 3b. Data migrace PG → PG17
./scripts/data-migrate.sh \
  --source="postgresql://supabase_admin:$PG_PW@old-db:5432/postgres" \
  --target="postgresql://supabase_admin:$PG17_PW@evymo-db:5432/postgres"

# 3c. Vault seed (pgcrypto secrets) — klíč trezoru si server čte sám ze souboru
#     /run/aisha-keys (entrypoint služby db), skript ho nepotřebuje
POSTGRES_PASSWORD="$PG17_PW" \
GATEWAY_URL="https://api.aisha.guru" \
SERVICE_ROLE_KEY="$SRK" \
GITHUB_APP_ID="$GH_APP_ID" \
GITHUB_APP_PRIVATE_KEY="$GH_APP_KEY" \
./scripts/vault-seed.sh \
  --import-admin-from="postgresql://supabase_admin:$PG_PW@old-db:5432/postgres"

# 3d. Storage migrace (Supabase S3 → MinIO)
SUPABASE_S3_ENDPOINT="http://old-storage:5000" \
SUPABASE_S3_ACCESS_KEY="$OLD_S3_KEY" \
SUPABASE_S3_SECRET_KEY="$OLD_S3_SECRET" \
MINIO_ENDPOINT="http://evymo-minio:9000" \
MINIO_ACCESS_KEY="$MINIO_KEY" \
MINIO_SECRET_KEY="$MINIO_SECRET" \
./scripts/storage-migrate.sh --mode=s3
```

### 4. Smoke test v2 stacku (bez externího traffic)

```bash
# Interní test — gateway přes docker network
GATEWAY_URL="http://evymo-gateway:3001" \
KC_URL="http://evymo-keycloak:8080" \
INTERNAL_API_KEY="$INTERNAL_KEY" \
./scripts/smoke-test-v2.sh
```

Ověřit:
- [ ] Všechny 16 microservices healthy
- [ ] PostgREST RPC proxy funguje
- [ ] KC OIDC discovery vrací správné endpointy
- [ ] MinIO buckety přístupné (8 buckets, 3 public)
- [ ] WebSocket gateway /health

### 5. DNS cutover — přepnutí domén

V Coolify → Stack settings → Docker Compose Domains:

```
# STARÝ mapping (v1 — docker-compose.coolify.yml):
# kong:8000         → api.aisha.guru
# studio-auth:4180  → db.aisha.guru
# web:80            → web.aisha.guru

# NOVÝ mapping (v2 — docker-compose.coolify-v2.yml):
gateway:3001       → api.aisha.guru
pgadmin-auth:4180  → db.aisha.guru
web:80             → web.aisha.guru
ws-gateway:3002    → ws.api.aisha.guru  (pokud WebSocket na vlastní doméně)
```

Postup:
1. **Maintenance mode** — přepnout web na maintenance stránku (volitelné)
2. V Coolify: Stop v1 stack (docker-compose.coolify.yml)
3. V Coolify: Nastavit domain labels na v2 stack
4. V Coolify: Redeploy v2 stack
5. Coolify automaticky aktualizuje Traefik labels → TLS certifikáty zůstávají (Traefik + Let's Encrypt)
6. **DNS záznamy se NEMĚNÍ** — domény ukazují na stejný server, mění se jen Traefik backend

### 6. Post-cutover validace

```bash
# Externí smoke test (přes public domain)
GATEWAY_URL="https://api.aisha.guru" \
KC_URL="https://auth.aisha.guru" \
./scripts/smoke-test-v2.sh

# Manuální testy:
# 1. Otevřít https://web.aisha.guru → SPA se načte
# 2. Login přes Google → KC OIDC → redirected zpět
# 3. Login přes Apple → KC OIDC → redirected zpět
# 4. Otevřít https://db.aisha.guru → KC login → pgAdmin
# 5. Mobile app → expo-auth-session → KC OIDC → token received
# 6. Stripe webhook test (Stripe dashboard → Send test event)
```

### 7. Rollback plán (pokud problém)

```bash
# 1. Stop v2 stack v Coolify
# 2. Obnovit domain labels na v1 stack
# 3. Restart v1 stack
# 4. DNS se nepřepínaly → Traefik okamžitě routuje zpět na v1
# Celý rollback < 2 minuty (žádný DNS propagation delay)
```

---

## Env vars pro Coolify (v2 stack)

### Povinné (bez nich stack nemůže nastartovat):

| Proměnná | Popis |
|----------|-------|
| `POSTGRES_PASSWORD` | PG17 superuser heslo |
| `JWT_SECRET` | PostgREST JWT secret (sdílený s gateway) |
| `VAULT_ENCRYPTION_KEY` | pgcrypto vault AES klíč (32+ chars) |
| `INTERNAL_API_KEY` | Bearer token pro inter-service komunikaci |
| `REDIS_PASSWORD` | Redis requirepass |
| `MINIO_ACCESS_KEY` | MinIO root user |
| `MINIO_SECRET_KEY` | MinIO root password |
| `KC_CLIENT_SECRET` | KC aisha-app client secret |
| `KEYCLOAK_ADMIN_PASSWORD` | KC admin heslo |
| `STUDIO_OIDC_SECRET` | KC studio-proxy client secret |
| `STUDIO_COOKIE_SECRET` | OAuth2 Proxy cookie encryption (32 bytes base64) |
| `ANON_KEY` | PostgREST anon JWT (read-only) |
| `SERVICE_ROLE_KEY` | PostgREST service_role JWT |
| `PGADMIN_PASSWORD` | pgAdmin default admin password |

### Volitelné (domény — defaults v compose):

| Proměnná | Default | Popis |
|----------|---------|-------|
| `KEYCLOAK_DOMAIN` | `auth.aisha.guru` | KC public domain |
| `API_DOMAIN` | `api.aisha.guru` | API domain |
| `STUDIO_DOMAIN` | `db.aisha.guru` | pgAdmin domain |

### Volitelné (external APIs):

| Proměnná | Služba |
|----------|--------|
| `OPENAI_API_KEY` | svc-ai-chat, svc-health-ai |
| `GOOGLE_AI_API_KEY` | svc-ai-chat |
| `ANTHROPIC_API_KEY` | svc-ai-chat |
| `STRIPE_SECRET_KEY` | svc-stripe |
| `STRIPE_WEBHOOK_SECRET` | svc-stripe |
| `RESEND_API_KEY` | svc-communications |
| `FIO_API_TOKEN` | svc-fio-bank |
| `LIVEKIT_API_KEY` | svc-livekit |
| `LIVEKIT_API_SECRET` | svc-livekit |
| `GITHUB_APP_ID` | svc-github-app |
| `GITHUB_APP_PRIVATE_KEY` | svc-github-app |
| `MCP_TOKEN` | svc-mcp-knowledge |
| `RAGNAROK_URL` | svc-mcp-knowledge, gateway |
| `RAGNAROK_API_KEY` | svc-mcp-knowledge, gateway |
| `COOLIFY_API_KEY` | gateway (deployment-executor) |
| `COOLIFY_BASE_URL` | gateway (deployment-executor) |
| `GITHUB_API_URL` / `GITHUB_REPOSITORY` | gateway (dev-patch; prázdné repo = `not_configured`) |
| `GITHUB_TOKEN` | gateway (dev-patch) |
| `PACKETA_API_KEY` | svc-packeta |
| `N8N_WEBHOOK_URL` | gateway |
| `N8N_API_KEY` | gateway |
| `IMGPROXY_KEY` | imgproxy (signed URLs) |
| `IMGPROXY_SALT` | imgproxy (signed URLs) |

---

## Architektura po migraci

```
Internet
  │
  ├── web.aisha.guru ──────── Traefik ──→ web:80 (nginx SPA)
  │
  ├── api.aisha.guru ──── Traefik ──→ gateway:3001 (Fastify)
  │                                           ├── /rest/v1/*  → PostgREST:3000
  │                                           ├── /auth/v1/*  → KC proxy
  │                                           ├── /storage/*  → storage-auth:3005 → MinIO
  │                                           ├── /functions/* → 14 microservices
  │                                           └── /internal/* → self (bearer auth)
  │
  ├── ws.api.aisha.guru ─ Traefik ──→ ws-gateway:3002 (WebSocket)
  │
  ├── db.aisha.guru ─ Traefik ──→ pgadmin-auth:4180 → pgAdmin:80
  │
  └── auth.aisha.guru ─────────────── Traefik ──→ keycloak:8080 (separate stack)

Internal network (evymo-network):
  db:5432 (PG17) ← PostgREST, gateway, 14 svcs, event-worker
  redis:6379     ← gateway, ws-gateway, event-worker, svcs
  minio:9000     ← storage-auth, imgproxy, minio-init
```
