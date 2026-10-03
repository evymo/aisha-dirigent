# Docker Compose Best Practices Review — AISHA v2

## Summary
Your compose files exhibit **strong architectural practices** with intentional design decisions, but have **several modernization opportunities** and some potential fragility risks.

**Overall Grade: B+ / 80%**

---

## ✅ Strengths

### 1. **Multi-File Separation & Stack Organization**
- Correct split by domain (core, keycloak, monitoring, n8n, etc.)
- Prevents monolithic compose files (reduces deployment blast radius)
- Reduces Coolify argv limit issues elegantly

### 2. **Anchor & Alias Pattern (YAML Reuse)**
- Excellent use of `x-v2-common`, `x-svc-common`, `x-svc-healthcheck`
- DRY principle respected: `restart`, `networks`, `environment` blocks reused
- Makes maintenance easier

### 3. **Health Checks Implemented**
- All stateful services have health checks
- Correct `depends_on: condition: service_healthy/service_started`
- Custom healthchecks where needed (gateway uses HTTP call via Node instead of wget)

### 4. **Startup Ordering**
- Proper dependency DAG: db → migrate → services
- One-shot services (`restart: "no"`) for init tasks (pki-init, migrate, minio-init)
- Migration runs **before** gateway/web depend on it

### 5. **Security-Aware**
- Readonly mounts for PKI certs: `- pki-certs:/certs/pki:ro`
- Separated privileged containers (netbird-agent with CAP_ADD)
- Secrets from environment variables (no hardcoded values)
- OIDC auth proxy pattern (oauth2-proxy + Keycloak)

### 6. **Network Isolation**
- External networks (`aisha-network`, `coolify`) to avoid per-stack address pool exhaustion
- Internal service discovery via DNS
- Proper network aliases for cross-stack communication

### 7. **Volume Naming**
- Explicit volume names: `aisha_v2_db-data` (avoids collisions)
- Consistent prefix for tracking

### 8. **Init Containers & Idempotent Scripts**
- minio-init and pki-init scripts are idempotent (use `--ignore-existing`, `|| true`)
- Good pattern for infrastructure-as-code

### 9. **Environment Defaults**
- Smart use of `${VAR:-default}` for optional values
- Required values use `:?error message` syntax (e.g., `${POSTGRES_PASSWORD:?}`)

### 10. **Comprehensive Comments**
- Clear documentation of design decisions (PKI strategy, DB role setup, network architecture)
- Explains *why* choices were made (e.g., why Dozzle is separate)

---

## ⚠️ Issues & Anti-Patterns

### 1. **minio Image Tag: `latest` (CRITICAL)**
```yaml
minio:
  image: minio/minio:latest      # ❌ BAD
  image: cache.aisha.guru/minio/minio:latest  # ❌ ALSO BAD
```
**Issue:** Floating tags are non-deterministic. Updates during pulls can cause unexpected breakage.
**Fix:**
```yaml
minio:
  image: cache.aisha.guru/minio/minio:2024.12.18  # Pinned semver
```
**Affected services:** minio, pgadmin (dpage/pgadmin4:latest), dozzle, netbird

### 2. **PostgreSQL Schema Initialization Missing**
```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U aisha_admin -h 127.0.0.1 && test -f /tmp/.db-passwords-ready"]
```
**Issue:** Healthcheck passes when DB is ready, but migration may fail silently if schema already exists or constraints conflict.
**Risk:** Multiple deployments can race; no idempotency guarantee visible in compose.
**Recommendation:** Add explicit schema versioning or migration lock table.

### 3. **Missing `cap_drop` (Security)**
```yaml
netbird-agent:
  cap_add:
    - NET_ADMIN
    - SYS_ADMIN
    - SYS_RESOURCE
```
**Issue:** No corresponding `cap_drop: ALL` to drop unnecessary capabilities.
**Fix:**
```yaml
netbird-agent:
  cap_drop:
    - ALL
  cap_add:
    - NET_ADMIN
    - SYS_ADMIN
    - SYS_RESOURCE
```

### 4. **Logging Configuration Missing**
No `logging` section in any service.
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```
**Risk:** Unbounded logs can fill disk on production deployments.

### 5. **Resource Limits Absent**
```yaml
# ❌ NO limits defined anywhere
gateway:
  environment: ...
  # Missing:
  # deploy:
  #   resources:
  #     limits:
  #       cpus: '1'
  #       memory: 1G
  #     reservations:
  #       cpus: '0.5'
  #       memory: 512M
```
**Risk:** OOM killer or CPU thrashing in Swarm/K8s contexts.
**Note:** Less critical on Coolify (single host), but violates best practices.

### 6. **Hardcoded Domain Fallback in Keycloak**
```yaml
KC_HOSTNAME: ${KEYCLOAK_DOMAIN:-auth.backend.id3a.cz}  # ❌ Hardcoded domain
```
**Issue:** Default assumes production domain; breaks dev/staging deployments.
**Fix:** Make it mandatory:
```yaml
KC_HOSTNAME: ${KEYCLOAK_DOMAIN:?KEYCLOAK_DOMAIN must be set}
```

### 7. **gateway Service Uses `dockerfile_inline` (Anti-Pattern)**
```yaml
gateway:
  build:
    dockerfile_inline: |
      FROM node:22-alpine
      ...
```
**Issues:**
- Not version-controlled in separate Dockerfile
- Harder to maintain/review
- IDE linters/formatters won't catch errors
- CI/CD build cache inspection impossible

**Fix:** Create `Dockerfile.gateway` (you already have most services like this).

### 8. **pgadmin/pgadmin-auth Bind Mount (Security Concern)**
```yaml
pgadmin:
  volumes:
    - pgadmin-data:/var/lib/pgadmin
    - ./coolify/pgadmin-servers.json:/pgadmin4/servers.json:ro  # ❌ HOST bind mount
```
**Issue:** Reads from host filesystem; path must exist or compose fails silently.
**Risk:** If `./coolify/pgadmin-servers.json` is missing, pgadmin won't have pre-configured servers.
**Fix:** Use COPY in build or Docker volume + init container.

### 9. **netbird-agent Uses `network_mode: host` (Not Composable)**
```yaml
netbird-agent:
  network_mode: host  # ❌ Can't set networks + network_mode together
  networks:
    - internal
```
**Issue:** Contradictory — `network_mode: host` means it ignores `networks` directive.
**Decision unclear:** Is this intentional (host mode preferred) or oversight?
**Fix:** If intentional, remove the `networks` line. If you need network isolation, remove `network_mode: host`.

### 10. **No `pull_policy` Specified (Implicit Behavior)**
```yaml
postgrest:
  image: postgrest/postgrest:v14.1
  # Missing: pull_policy: if-not-present | always | never
```
**Issue:** Docker Compose's default is `pull_policy: always`, causing every `compose up` to attempt a pull (slow, network intensive).
**Recommendation for production:**
```yaml
postgrest:
  image: postgrest/postgrest:v14.1
  pull_policy: if-not-present
```

### 11. **Redis & Minio Default Passwords in Compose**
```yaml
redis:
  command: >-
    redis-server ...
             --requirepass ${REDIS_PASSWORD}
```
**OK** (using env vars), but no secret rotation strategy documented.

### 12. **Init Script Double-Escaping in shared-minio-init**
```yaml
mc alias set local http://shared-minio:9000 "$${MINIO_ROOT_USER}" ...
```
**Issue:** Double `$$` is correct for shell-in-entrypoint, but fragile.
Better pattern: Use a config file or heredoc more carefully.

---

## 🔧 Quick Wins (Easy Fixes)

### 1. Pin All Image Tags
```bash
# Current: find . -name "docker-compose*.yml" -exec grep "image:.*:latest" {} \;
# Replace with semver pins
```

### 2. Add Resource Limits
```yaml
services:
  gateway:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 3. Add Logging to All Services
```yaml
services:
  db:
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "10"
```

### 4. Fix netbird-agent Contradiction
```yaml
# Option A: Keep host network
netbird-agent:
  image: netbirdio/netbird:latest
  network_mode: host
  # Remove: networks:

# Option B: Bridge mode (recommended for compose)
netbird-agent:
  image: netbirdio/netbird:latest
  networks:
    - internal
  # Remove: network_mode: host
```

### 5. Extract gateway Build to Dockerfile
```bash
# Create: Dockerfile.gateway
FROM node:22-alpine
WORKDIR /app
COPY services/gateway/package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/gateway/ .
RUN npm run build
ENV NODE_ENV=production
RUN npm prune --omit=dev
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

```yaml
# docker-compose.coolify.yml
gateway:
  build:
    context: .
    dockerfile: Dockerfile.gateway
```

---

## 📋 Best Practices Not Yet Implemented

### 1. **Compose Health Check Consolidation** (Compose 2.29+)
Current: Each service defines its own healthcheck.
Modern approach: Use `healthchecks` top-level directive for reusable templates.

### 2. **Service Profiles**
```yaml
services:
  debug-proxy:
    profiles: ["debug"]
    image: traefik:latest
```
Allows `docker compose --profile debug up`.

### 3. **Extension Fields for Templating**
You use `x-v2-common`, but could add:
```yaml
x-env-prod: &env-prod
  NODE_ENV: production
  LOG_LEVEL: error

x-env-dev: &env-dev
  NODE_ENV: development
  LOG_LEVEL: debug
```

### 4. **Secrets Management** (Docker Secrets / External)
Currently: All env vars.
Best practice: Use `docker secret` or external secret manager for production.
```yaml
secrets:
  db_password:
    external: true
    name: aisha-db-password

services:
  db:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
```

---

## 🏗️ Architectural Decisions (Good!)

### Why Separate Compose Files?
- ✅ Allows independent Coolify deployments
- ✅ Coolify helper argv limit workaround (smart!)
- ✅ Reduces blast radius of single stack failure
- ✅ Supports incremental platform growth

### Why Multiple Redis/MinIO across Stacks?
- ✅ Per-app isolation via ACL/IAM
- ✅ Failover independence
- ✅ (Shared variant in docker-compose.coolify-shared.yml shows this consideration)

### Why Init Containers (`restart: "no"`)?
- ✅ Runs once, doesn't restart
- ✅ Proper dependency ordering
- ✅ Idempotent scripts prevent conflicts

---

## 📝 Summary Table

| Area | Status | Notes |
|------|--------|-------|
| **Image Pinning** | ❌ | Use semver, not `latest` |
| **Health Checks** | ✅ | Well implemented |
| **Logging** | ❌ | Add log drivers to all services |
| **Resource Limits** | ❌ | Add deploy.resources section |
| **Security** | 🟡 | Good OIDC/RBAC, but missing cap_drop + hardcoded domain fallback |
| **Network Isolation** | ✅ | External networks, proper aliases |
| **Startup Ordering** | ✅ | Solid depends_on DAG |
| **Volume Management** | ✅ | Named volumes with prefixes |
| **Environment Config** | ✅ | Good use of defaults + required checks |
| **Documentation** | ✅ | Excellent inline comments |
| **Modularization** | ✅ | Smart multi-file separation |

---

## 🎯 Recommended Priority Fixes

**High Priority (Production Risk):**
1. Pin all image tags (minio, pgadmin, dozzle, netbird)
2. Add resource limits to memory-hungry services (db, redis, gateway)
3. Add logging configuration with max-size/max-file
4. Fix netbird-agent network_mode contradiction

**Medium Priority (Maintainability):**
5. Extract gateway's inline Dockerfile to Dockerfile.gateway
6. Make KEYCLOAK_DOMAIN mandatory (no hardcoded fallback)
7. Add cap_drop: ALL to netbird-agent

**Low Priority (Future):**
8. Implement Docker Secrets for password management
9. Add compose profiles for debug/dev deployments
10. Consider Compose 2.29+ health check templates

---

## Conclusion

Your AISHA v2 compose setup is **architecture-sound** with thoughtful design (multi-file separation, idempotent init, security-aware OIDC). The main gaps are **operational** (no resource limits, logging, image pinning) rather than architectural. Addressing the "High Priority" items above will bring you to **production-grade** practices.
