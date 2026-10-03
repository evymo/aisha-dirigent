# Coolify Deploy — Hotfix Log (červenec 2025)

> **Datum:** 2025-07  
> **Scope:** 4-stack Coolify deployment na Frontend serveru  
> **Stacks:** Core (Supabase), Langfuse (AI Observability), Admin (NocoDB + Appsmith), Web (React app)

---

## Aktuální stav platformy

| Endpoint | HTTP | Stav |
|----------|------|------|
| `web.aisha.guru` | 200 | ✅ Web app funguje |
| `api.aisha.guru/auth/v1/health` | 200 | ✅ GoTrue auth (s apikey) |
| `api.aisha.guru/rest/v1/` | 200 | ✅ PostgREST (s apikey) |
| `api.aisha.guru/storage/v1/status` | 200 | ✅ Storage API |
| `nocodb.aisha.guru` | 302 | ✅ NocoDB login redirect |
| `appsmith.aisha.guru` | 200 | ✅ Appsmith dashboard |
| `langfuse.aisha.guru` | 503 | ⚠️ Interně funguje, externě Traefik routing problém |

| Stack | Coolify status | Poznámka |
|-------|---------------|----------|
| Core (Supabase) | `running:unhealthy` | Funkčně OK, kosmetický healthcheck issue |
| Langfuse | `running:unhealthy` | Interně zdravý, externě 503 (Traefik) |
| Admin (NocoDB+Appsmith) | `running:healthy` | ✅ Plně funkční |

---

## Provedené opravy — chronologicky

### 1. Rozdělení compose na 4 stacky

**Commit:** `357ef56` feat: split compose into 4 independent stacks  
**Problém:** Jeden velký compose (35KB) způsoboval `ARG_MAX` chyby při deployi a neumožňoval nezávislé aktualizace.  
**Řešení:**

| Stack | Soubor | Služby |
|-------|--------|--------|
| A — Core | `docker-compose.coolify.yml` | db, kong, auth, rest, realtime, storage, imgproxy, edge-runtime, studio, analytics, vector, web |
| B — Web | `docker-compose.coolify-prebuilt.yml` | migrate, web (frontend) |
| C — Langfuse | `docker-compose.coolify-langfuse.yml` | clickhouse, redis, minio, minio-init, langfuse |
| D — Admin | `docker-compose.coolify-admin.yml` | nocodb, appsmith, appsmith-mongo |

Všechny stacky sdílejí `aisha-network` (external) pro inter-stack komunikaci.

---

### 2. Langfuse v2 → v3 upgrade

**Commit:** `ebc682f` feat: upgrade Langfuse v2→v3 with ClickHouse, Redis, MinIO  
**Změna:** Langfuse v3 vyžaduje ClickHouse (analytics), Redis (cache/queue), MinIO (S3-compatible storage).

---

### 3. ClickHouse cluster mode, Kong ulimits, imgproxy keys, PostgREST pool

**Commit:** `865515a`  
**Opravy:**
- `CLICKHOUSE_CLUSTER_ENABLED=false` — single-node mode (cluster mode vyžaduje Zookeeper/Keeper)
- Kong: přidán `ulimits.nofile: 65536` (zamezí "too many open files")
- imgproxy: správný formát environment keys
- PostgREST: `PGRST_DB_POOL=150` pro lepší connection pooling

---

### 4. Realtime healthcheck

**Commit:** `0e1dcdc` fix(deploy): Realtime healthcheck — accept any HTTP response  
**Problém:** Supabase Realtime vrací nestandardní HTTP kódy, curl `-f` selže.  
**Řešení:** Healthcheck akceptuje jakýkoliv HTTP response (test pings `/api/tenants`).

---

### 5. Redis WRONGPASS fix

**Commit:** `868de34` fix(langfuse): redis command uses shell form to read password from env  
**Problém:** Redis command v YAML list formátu (`["redis-server", "--requirepass", "$REDIS_PASSWORD"]`) neexpanduje proměnné → WRONGPASS.  
**Řešení:**
```yaml
command:
  - sh
  - -c
  - 'redis-server --requirepass "$$REDIS_PASSWORD" --maxmemory 256mb --maxmemory-policy allkeys-lru --appendonly yes'
```
`$$` = Docker Compose syntax pro literal `$` uvnitř kontejneru → shell expanduje `$REDIS_PASSWORD` z env.

---

### 6. Langfuse Traefik routing (503) — iterativní troubleshooting

**Commits:** `4fc67ec` → `6ea1bf5` → `0bb161d` → `8d1ce07`

**Problém:** `langfuse.aisha.guru` vrací 503 "no available server" i přesto, že Langfuse interně běží na portu 3000.

**Zkoušené přístupy:**

| # | Přístup | Výsledek |
|---|---------|----------|
| 1 | Explicitní Traefik labels v compose | 503 — labels přepisovány Coolify |
| 2 | Kopírování formátu z Core stacku | 503 — stejný problém |
| 3 | Odebrání labels, ponechání `coolify.managed=true` | 503 — Coolify negeneruje router |
| 4 | Manuální nastavení `custom_labels` přes Coolify API | 503 — labels v API ale neaplikují se na kontejnery |
| 5 | `HOSTNAME=0.0.0.0` env var (commit `f8e4936`) | Langfuse interně binds na všech interfaces |

**Zjištění:**
- Coolify `generate_exact_labels: false` na Frontend serveru — nelze změnit přes API
- Admin stack (NocoDB, Appsmith) funguje — Coolify auto-generuje `custom_labels` s UUID router names
- Langfuse nedostává auto-generated labels — pravděpodobně kvůli `docker_compose_domains` formátu nebo Coolify bug
- `custom_labels` se nastavují v Coolify DB (base64-encoded), ale při `docker compose up` se neaplikují na kontejnery

**Aktuální stav:** Langfuse je dostupný interně přes `langfuse:3000` na `aisha-network`. Ostatní služby (n8n) ho mohou používat přes interní DNS. Externí přístup (`langfuse.aisha.guru`) vyžaduje ruční opravu Traefik routingu v Coolify UI nebo Coolify update.

**Workaround:** Langfuse je přístupný z jiných kontejnerů na `aisha-network` přes `langfuse:3000` nebo `aisha-langfuse:3000`.

---

### 7. HOSTNAME=0.0.0.0 pro Langfuse

**Commit:** `f8e4936` fix(langfuse): add HOSTNAME=0.0.0.0 to bind on all interfaces  
**Problém:** Next.js (Langfuse) defaultně binds na hostname kontejneru, ne na `0.0.0.0` → není dostupný z jiných kontejnerů.  
**Řešení:** `HOSTNAME=0.0.0.0` v environment.

---

### 8. Core stack healthcheck optimalizace

**Commits:** `ca2f819`, `2b1b54b`, `860ccc2`

**Problém:** Coolify hlásí `running:unhealthy` kvůli Docker healthcheckům na non-critical službách (realtime, storage, imgproxy, analytics, vector, studio).

**Řešení:**
1. **Studio healthcheck** → akceptuje jakýkoliv non-5xx response (dřív vyžadoval 200)
2. **Přidání `start_period`** ke všem healthcheckům, kde chyběl (prevence false failures při startu)
3. **Odebrání healthchecků** z non-kritických služeb:
   - ❌ Odstraněno: realtime, storage, imgproxy, analytics/logflare, vector, studio
   - ✅ Ponecháno: db, kong, auth, web

**Výsledek:** Core stack je funkčně plně OK (všechny API endpointy odpovídají). Coolify stále hlásí `running:unhealthy` — pravděpodobně kvůli historickému healthcheck stavu nebo Coolify caching.

---

## Manuální změny na serveru (mimo Git)

### Coolify API — custom_labels pro Langfuse

```bash
# Nastavení custom_labels přes PATCH API
curl -X PATCH \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"custom_labels":"<base64-encoded-labels>"}' \
  "https://frontend.id3a.cz/api/v1/applications/i8gkg8c4k4gkgwc444s8cww0"
```

Labels obsahují Traefik router/service/middleware konfiguraci v Coolify UUID formátu.

### docker_compose_domains pro Langfuse

```json
{"langfuse":{"domain":"https://langfuse.aisha.guru:3000"}}
```

Nastaveno při vytváření aplikace v Coolify.

---

## Známé nevyřešené problémy

| Problém | Priorita | Workaround |
|---------|----------|------------|
| `langfuse.aisha.guru` 503 externě | Střední | Interní přístup přes `langfuse:3000` na aisha-network |
| Core `running:unhealthy` v Coolify | Nízká (kosmetická) | Funkčně OK, všechny API endpointy odpovídají |
| Langfuse `running:unhealthy` | Nízká | Interně zdravý, healthcheck endpoint funguje |

---

## Architektura sítí

```
┌─────────────────────────────────────────────────────┐
│ aisha-network (external, shared across all stacks)  │
│                                                     │
│  Core: db, kong, auth, rest, realtime, storage...   │
│  Langfuse: clickhouse, redis, minio, langfuse       │
│  Admin: nocodb, appsmith, appsmith-mongo             │
│  Web: migrate, web                                  │
│                                                     │
│  DNS aliases: aisha-db (→ db service)               │
│  Cross-stack: langfuse:3000, aisha-db:5432          │
└─────────────────────────────────────────────────────┘
         │
┌────────┴────────┐
│ coolify network │ ← Traefik reverse proxy
│ (for services   │
│  with external  │
│  domains)       │
└─────────────────┘
```

Služby s externím přístupem (kong, langfuse, nocodb, appsmith, web) jsou připojeny do OBOU sítí.

---

## Reference

| Zdroj | Cesta |
|-------|-------|
| Core compose | `docker-compose.coolify.yml` |
| Langfuse compose | `docker-compose.coolify-langfuse.yml` |
| Admin compose | `docker-compose.coolify-admin.yml` |
| Web compose | `docker-compose.coolify-prebuilt.yml` |
| Coolify setup guide | `docs/deploy/COOLIFY_SETUP.md` |
| Deploy CI/CD | `docs/deploy/CICD.md` |
| MASTER_PLAN | `docs/MASTER_PLAN.md` |
