#!/usr/bin/env bash
# Idempotent local-only Keycloak provisioning for Playwright E2E.
# Keeps production realm imports free of test passwords and ROPC settings.
set -euo pipefail

KCADM="${KCADM:-/opt/keycloak/bin/kcadm.sh}"
KCADM_TIMEOUT="${KCADM_TIMEOUT:-30}"
KC_SERVER="${KC_SERVER:-http://127.0.0.1:${KC_HTTP_PORT:-80}}"
KC_ADMIN_USER="${KC_ADMIN_USER:-${KEYCLOAK_ADMIN:-admin}}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-${KEYCLOAK_ADMIN_PASSWORD:-}}"
KC_REALM="${KC_REALM:-aisha}"
KC_CLIENT_ID="${KC_CLIENT_ID:-aisha-app}"

if [ -z "$KC_ADMIN_PASS" ]; then
  echo "[AISHA E2E] Missing KC_ADMIN_PASS or KEYCLOAK_ADMIN_PASSWORD."
  exit 1
fi

csv_first_value() {
  tr -d '\r"' | sed -n '1p'
}

kcadm() {
  timeout "$KCADM_TIMEOUT" "$KCADM" "$@"
}

client_uuid() {
  kcadm get clients -r "$KC_REALM" -q clientId="$KC_CLIENT_ID" --fields id --format csv | csv_first_value
}

user_uuid_by_username() {
  local username="$1"
  kcadm get users -r "$KC_REALM" -q username="$username" --fields id --format csv | csv_first_value
}

ensure_subject_mapper() {
  local client_id="$1"
  local mapper_name="subject-mapper"

  if kcadm get "clients/$client_id/protocol-mappers/models" -r "$KC_REALM" \
    | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$mapper_name\""; then
    return
  fi

  local mapper_file
  mapper_file="$(mktemp)"
  cat > "$mapper_file" <<'JSON'
{
  "name": "subject-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-sub-mapper",
  "config": {
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON
  kcadm create "clients/$client_id/protocol-mappers/models" -r "$KC_REALM" -f "$mapper_file" >/dev/null
  rm -f "$mapper_file"
}

ensure_realm_roles_mapper() {
  local client_id="$1"
  local mapper_name="realm-roles"

  if kcadm get "clients/$client_id/protocol-mappers/models" -r "$KC_REALM" \
    | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$mapper_name\""; then
    return
  fi

  local mapper_file
  mapper_file="$(mktemp)"
  cat > "$mapper_file" <<'JSON'
{
  "name": "realm-roles",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-realm-role-mapper",
  "consentRequired": false,
  "config": {
    "multivalued": "true",
    "userinfo.token.claim": "true",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "claim.name": "realm_access.roles",
    "jsonType.label": "String"
  }
}
JSON
  kcadm create "clients/$client_id/protocol-mappers/models" -r "$KC_REALM" -f "$mapper_file" >/dev/null
  rm -f "$mapper_file"
}

provision_e2e_users() {
  local import_file
  import_file="$(mktemp)"
  cat > "$import_file" <<'JSON'
{
  "ifResourceExists": "OVERWRITE",
  "roles": {
    "realm": [
      { "name": "admin" },
      { "name": "staff" },
      { "name": "member" },
      { "name": "practitioner" },
      { "name": "studio_access" },
      { "name": "n8n_access" }
    ]
  },
  "users": [
    {
      "id": "e2e00000-0000-0000-0000-000000000001",
      "username": "admin@platform.rtn",
      "email": "admin@platform.rtn",
      "firstName": "E2E",
      "lastName": "Admin",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["admin", "staff", "member", "studio_access", "n8n_access"],
      "credentials": [{ "type": "password", "value": "Admin123!", "temporary": false }]
    },
    {
      "id": "e2e00000-0000-0000-0000-000000000002",
      "username": "member@platform.rtn",
      "email": "member@platform.rtn",
      "firstName": "E2E",
      "lastName": "Member",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["member"],
      "credentials": [{ "type": "password", "value": "Member123!", "temporary": false }]
    },
    {
      "id": "e2e00000-0000-0000-0000-000000000003",
      "username": "partner@platform.rtn",
      "email": "partner@platform.rtn",
      "firstName": "E2E",
      "lastName": "Partner",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["practitioner", "member"],
      "credentials": [{ "type": "password", "value": "Partner123!", "temporary": false }]
    },
    {
      "id": "e2e00000-0000-0000-0000-000000000004",
      "username": "staff@platform.rtn",
      "email": "staff@platform.rtn",
      "firstName": "E2E",
      "lastName": "Staff",
      "enabled": true,
      "emailVerified": true,
      "realmRoles": ["staff", "member", "studio_access"],
      "credentials": [{ "type": "password", "value": "Staff123!", "temporary": false }]
    }
  ]
}
JSON
  kcadm create partialImport -r "$KC_REALM" -f "$import_file" >/dev/null
  rm -f "$import_file"
  echo "[AISHA E2E] User admin@platform.rtn ready: app_user_id=e2e00000-0000-0000-0000-000000000001"
  echo "[AISHA E2E] User member@platform.rtn ready: app_user_id=e2e00000-0000-0000-0000-000000000002"
  echo "[AISHA E2E] User partner@platform.rtn ready: app_user_id=e2e00000-0000-0000-0000-000000000003"
  echo "[AISHA E2E] User staff@platform.rtn ready: app_user_id=e2e00000-0000-0000-0000-000000000004"
}

echo "[AISHA E2E] Authenticating Keycloak admin at $KC_SERVER"
kcadm config credentials \
  --server "$KC_SERVER" \
  --realm master \
  --user "$KC_ADMIN_USER" \
  --password "$KC_ADMIN_PASS" >/dev/null

CLIENT_UUID="$(client_uuid)"
if [ -z "$CLIENT_UUID" ]; then
  echo "[AISHA E2E] Client $KC_CLIENT_ID not found in realm $KC_REALM."
  exit 1
fi

kcadm update "clients/$CLIENT_UUID" -r "$KC_REALM" \
  -s publicClient=true \
  -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=true >/dev/null

ensure_subject_mapper "$CLIENT_UUID"
ensure_realm_roles_mapper "$CLIENT_UUID"
provision_e2e_users

echo "[AISHA E2E] Keycloak E2E client and users are ready."
