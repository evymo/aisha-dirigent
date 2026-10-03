#!/usr/bin/env bash
# ============================================================================
# omni-local-verify.sh — LOCAL real-backend verification for AISHA Omni
# ============================================================================
# "Lokální testování reálného fungování je základ." One command that owns the
# WHOLE local real-backend loop so we never re-litigate "is docker/node here?".
#
# PROVEN PATH (not the full 25-container edge devstack — that needs the `web`
# image to build, which FATALs locally on render-app-config, and svc-ai-chat
# isn't even in the `optimum` preset). The Omni surface lives in svc-ai-chat,
# which runs as a HOST node process; the edge only proxies to it. So the
# minimal real backend is:
#
#   3 prebuilt infra containers   db + redis + postgrest   (no image build)
#   3 workspace libs built (tsc)  @aisha/{observability,security,aitg}
#   svc-ai-chat as a host process on :3011  (tsx watch src/server.ts)
#
# Then the Omni triad runs against the LIVE :3011 backend:
#   a) acceptance/unit  — vitest.omni-acceptance.config.ts (spec-as-tests)
#   b) integration      — pgTAP aisha/db/tests/schema/omni/* (live DB :54322)
#   c) e2e              — Playwright e2e/omni/* via playwright.prod.config.ts
#                         (no webServer/KC; request-fixture hits ${OMNI_BASE_URL})
#
# RED is EXPECTED until the §22 steps land (e.g. /v1 → 404 ⇒ streaming/protocol
# specs fail by design; PAT/tenant specs skip until BASE-1). This never fails
# the shell on RED tests — it prints a per-layer summary so progress is visible.
#
# Usage:
#   bash scripts/test/omni-local-verify.sh             # up + boot + triad
#   STACK_ONLY=1 bash scripts/test/omni-local-verify.sh    # up + boot, no tests
#   SKIP_E2E=1   bash scripts/test/omni-local-verify.sh     # unit + pgTAP only
#   STOP=1       bash scripts/test/omni-local-verify.sh     # stop svc-ai-chat + infra
#
# Env overrides:
#   OMNI_BASE_URL (default http://127.0.0.1:3011 — host svc-ai-chat)
#   OMNI_PAT / OMNI_TENANT_A_JWT / OMNI_TENANT_B_JWT  (lands at BASE-1; until
#       then PAT/tenant e2e self-skip — expected)
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root
ROOT="$(pwd)"

Y='\033[1;33m'; G='\033[0;32m'; R='\033[0;31m'; D='\033[0;90m'; NC='\033[0m'
step() { echo -e "${Y}━━━ $1 ━━━${NC}"; }

# ── 1. PATH: Docker Desktop CLI (off-PATH on this host) + Node 22 (.nvmrc) ───
if ! command -v docker >/dev/null 2>&1; then
  for d in /Applications/Docker.app/Contents/Resources/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/docker" ] && export PATH="$d:$PATH" && break
  done
fi
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; nvm use >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true; fi
command -v docker >/dev/null 2>&1 || { echo -e "${R}docker CLI not found — install Docker Desktop${NC}"; exit 2; }
echo -e "${D}node $(node -v 2>/dev/null) · docker $(docker --version 2>/dev/null | awk '{print $3}' | tr -d ,)${NC}"

LOCAL_STACK="${AISHA_LOCAL_STACK:-aisha-local}"
COMPOSE=(docker compose -p "$LOCAL_STACK" -f docker-compose.local.generated.json --env-file .env.local.dev)
OMNI_BASE_URL="${OMNI_BASE_URL:-http://127.0.0.1:3011}"
PIDFILE="$ROOT/.svc-ai-chat.local.pid"
LOGFILE="$ROOT/.svc-ai-chat.local.log"

# ── STOP mode ───────────────────────────────────────────────────────────────
if [ "${STOP:-0}" = "1" ]; then
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && echo "svc-ai-chat stopped" || true
  rm -f "$PIDFILE"
  "${COMPOSE[@]}" stop db redis postgrest 2>/dev/null || true
  echo -e "${G}stopped svc-ai-chat + infra (containers kept; 'docker compose ... down -v' to wipe)${NC}"; exit 0
fi

# ── 2. Docker daemon up ─────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  step "Starting Docker Desktop"; open -a Docker 2>/dev/null || true
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || { echo -e "${R}Docker daemon did not come up${NC}"; exit 2; }
fi

# ── 3. Infra containers (prebuilt — no image build) ─────────────────────────
step "infra: db + redis + postgrest (prebuilt)"
"${COMPOSE[@]}" up -d db redis postgrest || { echo -e "${R}infra up failed${NC}"; exit 3; }
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${LOCAL_STACK}__aisha-db" 2>/dev/null)" = "healthy" ] && break; sleep 1
done

# ── 4. Workspace libs svc-ai-chat imports (build once if missing) ───────────
for p in observability security aitg; do
  if [ ! -d "packages/$p/dist" ]; then step "build @aisha/$p"; (cd "packages/$p" && npm run build >/dev/null 2>&1) || echo -e "${R}build $p failed${NC}"; fi
done

# ── 5. svc-ai-chat as a host process on :3011 (idempotent) ──────────────────
# Guard (non-destructive): a stale CONTAINERIZED svc publishing host :3011 answers
# /health and so masquerades as "already healthy" in the idempotency check below —
# but it runs old code / a service token that does not match this run, so the host
# svc never binds (port taken) and EVERY PAT-gated e2e silently hits the WRONG
# process and returns 401. This harness owns :3011 as a HOST process. We do NOT
# touch docker state here — fail loud with the exact fix so the operator decides.
if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E ':3011->' >/dev/null; then
  STALE_C="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep ':3011->' | awk '{print $1}' | tr '\n' ' ')"
  echo -e "${R}✗ host :3011 is published by container(s): ${STALE_C}${NC}"
  echo -e "${R}  This harness needs a HOST svc-ai-chat on :3011; a container there shadows it and${NC}"
  echo -e "${R}  every PAT-gated e2e would silently hit the wrong svc (uniform 401). Free it first:${NC}"
  echo -e "${R}    docker rm -f ${STALE_C}${NC}"
  exit 3
fi
if curl -fsS -m 3 "$OMNI_BASE_URL/health" >/dev/null 2>&1; then
  echo -e "${G}svc-ai-chat already healthy at $OMNI_BASE_URL${NC}"
else
  step "boot svc-ai-chat (host process)"
  # PostgREST validates a real HS256 JWT (PGRST_JWT_SECRET = JWT_SECRET) — the
  # .env POSTGREST_SERVICE_TOKEN is a placeholder, NOT a JWT. Mint a service_role JWT.
  JWT_SECRET="$(grep -oE '^JWT_SECRET=.*' .env.local.dev | head -1 | sed 's/^[^=]*=//')"
  PGTOKEN="$(JWT_SECRET="$JWT_SECRET" node -e "const c=require('crypto');const s=process.env.JWT_SECRET;const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const n=Math.floor(Date.now()/1000);const d=b({alg:'HS256',typ:'JWT'})+'.'+b({role:'service_role',iat:n,exp:n+31536000});console.log(d+'.'+c.createHmac('sha256',s).update(d).digest('base64url'));")"
  # Local model backend for real SSE content (§7): Docker Desktop Model Runner if
  # up (enable: `docker desktop enable model-runner`; pull: `docker model pull ai/smollm2`).
  # Without it the tier1/2 SSE path returns 502 no_backend (auth/routing still verifiable).
  DOCKER_MR=""
  if curl -fsS -m 3 http://localhost:12434/engines/v1/models >/dev/null 2>&1; then
    DOCKER_MR="http://localhost:12434/engines/v1"
    echo -e "${G}Docker Model Runner detected → real SSE content enabled${NC}"
  fi
  ( cd services/svc-ai-chat && \
    SVC_AI_CHAT_PORT=3011 POSTGREST_URL=http://127.0.0.1:3000 POSTGREST_SERVICE_TOKEN="$PGTOKEN" \
    KEYCLOAK_URL=http://127.0.0.1:8180 KEYCLOAK_REALM=aisha RATE_LIMIT_ENABLED=false LOG_LEVEL=info \
    CORS_ALLOWLIST="http://127.0.0.1:4173,http://localhost:4173" \
    DOCKER_MODEL_RUNNER_URL="$DOCKER_MR" DOCKER_MODEL="${DOCKER_MODEL:-ai/smollm2}" \
    npm run dev >"$LOGFILE" 2>&1 & echo $! >"$PIDFILE" )
  for _ in $(seq 1 40); do curl -fsS -m 3 "$OMNI_BASE_URL/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS -m 3 "$OMNI_BASE_URL/health" >/dev/null 2>&1 \
    && echo -e "${G}svc-ai-chat healthy (pid $(cat "$PIDFILE"), log $LOGFILE)${NC}" \
    || { echo -e "${R}svc-ai-chat did not become healthy — tail $LOGFILE${NC}"; tail -20 "$LOGFILE"; exit 3; }
fi
[ "${STACK_ONLY:-0}" = "1" ] && { echo -e "${G}Backend up (STACK_ONLY).${NC}  edge: $OMNI_BASE_URL"; exit 0; }

# ── 5b. Seed a deterministic e2e PAT bound to a seeded story so the PAT-gated /v1
#        e2e (streaming-routing, protocol-statefulness, …) run GREEN instead of
#        self-skipping. Idempotent; dynamic story/user pick; if no story is seeded,
#        OMNI_PAT stays unset and those specs self-skip (matches the !PAT guard).
OMNI_PAT_RAW="${OMNI_PAT:-mcp_e2e_omni_local_verify}"
OMNI_PAT_HASH="$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$OMNI_PAT_RAW")"
PAT_ROW="$("${COMPOSE[@]}" exec -T db psql -U postgres -tAc "select ps.id||'|'||coalesce(ps.user_id::text,(select id::text from aisha_auth.users limit 1)) from partner_stories ps order by ps.created_at limit 1" 2>/dev/null | tr -d '[:space:]')"
PAT_STORY="${PAT_ROW%%|*}"; PAT_USER="${PAT_ROW##*|}"
if [ -n "$PAT_STORY" ] && [ -n "$PAT_USER" ]; then
  "${COMPOSE[@]}" exec -T db psql -U postgres -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
DELETE FROM mcp_auth_tokens WHERE token_hash='$OMNI_PAT_HASH';
INSERT INTO mcp_auth_tokens (token_hash, scope, allowed_tools, denied_tools, is_active, expires_at, user_id, created_by, scoped_to_story_id)
VALUES ('$OMNI_PAT_HASH','account','{}','{}',true,NULL,'$PAT_USER','$PAT_USER','$PAT_STORY');
SQL
  export OMNI_PAT="$OMNI_PAT_RAW"
  echo -e "${G}seeded e2e PAT (scope=account · story=$PAT_STORY) → OMNI_PAT exported${NC}"
else
  echo -e "${D}no seeded story → OMNI_PAT unset; PAT-gated e2e self-skip${NC}"
fi

export OMNI_ACCEPTANCE=1 OMNI_BASE_URL OMNI_PAT E2E_BASE_URL="$OMNI_BASE_URL"

# ── 6a. Acceptance / unit (spec-as-tests) ───────────────────────────────────
step "[1/3] acceptance/unit — vitest.omni-acceptance.config.ts"
npx vitest run --config vitest.omni-acceptance.config.ts --reporter=dot 2>&1 | tail -25 || true

# ── 6b. Integration — pgTAP against the LIVE devstack DB (:54322) ───────────
step "[2/3] integration — pgTAP omni (live DB)"
if command -v pg_prove >/dev/null 2>&1; then
  PGPASSWORD="${PGPASSWORD:-postgres}" pg_prove -d "postgresql://postgres@127.0.0.1:54322/postgres" aisha/db/tests/schema/omni/*.sql 2>&1 | tail -20 || true
elif "${COMPOSE[@]}" exec -T db psql -U postgres -tAc "select 1" >/dev/null 2>&1; then
  # pg_prove absent on host → run the pgTAP files through the db container's psql
  # (trust auth, no host password) and parse the TAP stream ourselves.
  echo -e "${D}pg_prove absent → running pgTAP via the db container's psql (TAP parse)${NC}"
  "${COMPOSE[@]}" exec -T db psql -U postgres -q -c "CREATE EXTENSION IF NOT EXISTS pgtap" >/dev/null 2>&1 || true
  pt_ok=0; pt_notok=0; pt_err=0
  for f in aisha/db/tests/schema/omni/*.sql; do
    out="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -X -q -tA < "$f" 2>&1)"
    ok=$(echo "$out" | grep -cE '^ok '); notok=$(echo "$out" | grep -cE '^not ok'); err=$(echo "$out" | grep -cE '^(psql:|ERROR:|FATAL)')
    pt_ok=$((pt_ok+ok)); pt_notok=$((pt_notok+notok)); pt_err=$((pt_err+err))
    printf "    %-38s ok=%-3s not-ok=%-2s err=%s\n" "$(basename "$f")" "$ok" "$notok" "$err"
    [ "$notok" -gt 0 ] && echo "$out" | grep -E '^not ok' | sed 's/^/        /' | head -8
  done
  echo -e "${D}    pgTAP totals: ok=$pt_ok not-ok=$pt_notok err=$pt_err — not-ok are documented future-spec RED (AISHA_OMNI_GATEWAY.md §23); err MUST be 0${NC}"
  [ "$pt_err" -gt 0 ] && echo -e "${R}    pgTAP had hard errors (err>0) — schema/apply regression${NC}"
else
  echo -e "${D}skipped: no pg_prove and db container not reachable${NC}"
fi

# ── 6c. e2e — Playwright against the LIVE :3011 backend (no webServer/KC) ────
if [ "${SKIP_E2E:-0}" != "1" ]; then
  step "[3/3] e2e — Playwright e2e/omni against $OMNI_BASE_URL"
  npx playwright test e2e/omni/ --config=playwright.prod.config.ts --project=chromium --reporter=list 2>&1 | tail -40 || true
fi

echo -e "${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${G}Omni local real-backend verification complete.${NC}"
echo "  backend: $OMNI_BASE_URL (svc-ai-chat host) · db :54322 · postgrest :3000 · redis :6379"
echo "  RED is expected until §22 steps land (see docs/planning/AISHA_OMNI_GATEWAY.md §23). Stop: STOP=1 $0"
