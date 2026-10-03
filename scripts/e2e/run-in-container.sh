#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

ANON_KEY="${VITE_AISHA_GATEWAY_KEY:-${VITE_AISHA_POSTGREST_PUBLISHABLE_KEY:-}}"
SERVICE_ROLE_KEY="${AISHA_POSTGREST_SERVICE_KEY:-}"
if [ -z "$SERVICE_ROLE_KEY" ]; then echo "ERROR: set AISHA_POSTGREST_SERVICE_KEY (no committed fallback)" >&2; exit 1; fi

docker network create coolify >/dev/null 2>&1 || true
docker compose --env-file .env.coolify \
  -f docker-compose.coolify.yml \
  -f docker-compose.coolify-keycloak.yml \
  -f docker-compose.e2e.yml \
  up -d --build db postgrest migrate keycloak gateway svc-mcp-knowledge

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/health/ready >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose --env-file .env.coolify \
  -f docker-compose.coolify.yml \
  -f docker-compose.coolify-keycloak.yml \
  -f docker-compose.e2e.yml \
  exec -T keycloak bash /opt/keycloak/provision-e2e.sh

docker compose --env-file .env.coolify \
  -f docker-compose.coolify.yml \
  -f docker-compose.coolify-keycloak.yml \
  -f docker-compose.e2e.yml \
  exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < aisha/db/seed.e2e.sql

sync_identity_mapping() {
  local app_user_id="$1"
  local email="$2"
  local keycloak_user_id

  keycloak_user_id="$(docker compose --env-file .env.coolify \
    -f docker-compose.coolify.yml \
    -f docker-compose.coolify-keycloak.yml \
    -f docker-compose.e2e.yml \
    exec -T keycloak bash -lc "/opt/keycloak/bin/kcadm.sh config credentials --server http://127.0.0.1:80 --realm master --user \"\$KEYCLOAK_ADMIN\" --password \"\$KEYCLOAK_ADMIN_PASSWORD\" >/dev/null && /opt/keycloak/bin/kcadm.sh get users -r aisha -q username=${email} --fields id --format csv | tr -d '\\r\"' | sed -n '1p'")"

  docker compose --env-file .env.coolify \
    -f docker-compose.coolify.yml \
    -f docker-compose.coolify-keycloak.yml \
    -f docker-compose.e2e.yml \
    exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -v app_user_id="$app_user_id" \
    -v email="$email" \
    -v provider_id="$keycloak_user_id" <<'SQL'
DELETE FROM aisha_auth.identities
WHERE provider = 'keycloak'
  AND email = :'email';

INSERT INTO aisha_auth.identities (user_id, provider, provider_id, email, identity_data, updated_at, last_sign_in_at)
VALUES (
  :'app_user_id'::uuid,
  'keycloak',
  :'provider_id',
  :'email',
  jsonb_build_object('sub', :'provider_id', 'email', :'email', 'app_user_id', :'app_user_id'),
  now(),
  now()
)
ON CONFLICT (provider, provider_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    email = EXCLUDED.email,
    identity_data = EXCLUDED.identity_data,
    updated_at = now(),
    last_sign_in_at = now();
SQL
}

sync_identity_mapping "e2e00000-0000-0000-0000-000000000001" "admin@platform.rtn"
sync_identity_mapping "e2e00000-0000-0000-0000-000000000002" "member@platform.rtn"
sync_identity_mapping "e2e00000-0000-0000-0000-000000000003" "partner@platform.rtn"
sync_identity_mapping "e2e00000-0000-0000-0000-000000000004" "staff@platform.rtn"

# Edge functions are routed through the Gateway /functions/v1 facade.
FUNCTIONS_PID=0

npm run dev:e2e >/tmp/aisha-playwright-dev.log 2>&1 &
DEV_SERVER_PID=$!

cleanup() {
  kill "$FUNCTIONS_PID" >/dev/null 2>&1 || true
  kill "$DEV_SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:8080/health/ready >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:3001/functions/v1/mcp-knowledge-server >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:4173 >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker run --rm \
  -v "$ROOT_DIR:/work" \
  -v evymo-playwright-node_modules:/work/node_modules \
  -w /work \
  -e CI=1 \
  -e E2E_BASE_URL=http://host.docker.internal:4173 \
  -e E2E_SKIP_SERVER=1 \
  -e VITE_AISHA_GATEWAY_URL=http://host.docker.internal:3001 \
  -e VITE_AISHA_GATEWAY_KEY="$ANON_KEY" \
  -e VITE_AISHA_POSTGREST_URL=http://host.docker.internal:3001 \
  -e VITE_AISHA_POSTGREST_ANON_KEY="$ANON_KEY" \
  -e VITE_AISHA_POSTGREST_PUBLISHABLE_KEY="$ANON_KEY" \
  -e VITE_KC_URL=http://host.docker.internal:8080 \
  -e VITE_KC_AUTHORITY="http://host.docker.internal:8080/realms/${KEYCLOAK_REALM:?KEYCLOAK_REALM required}" \
  -e AISHA_POSTGREST_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  mcr.microsoft.com/playwright:v1.59.1-jammy \
  /bin/bash -lc "npm ci && npx playwright test $*"
