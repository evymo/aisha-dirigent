#!/usr/bin/env bash
# =============================================================================
# federation-login.sh — end-to-end proof of the federated source-member login.
# =============================================================================
# A source-app member federates into a SCOPED aisha session through the
# svc-source-broker, then we prove the session is least-privilege:
#
#   1. POST /auth/source/start { email }            → { onboardingToken }
#   2. read the one-time password (OTP) from Mailhog (the source app mails it)
#   3. POST /auth/source/login { onboardingToken, code } → { aishaToken, member }
#   4. decode aishaToken — it MUST carry the federated, least-privilege claims
#      (source_member=true, federated_from=source-api), NOT operator claims
#   5. backend security checks with that token:
#        • self-scope RPC  audience_get_my_tier   → member sees ONLY their tier
#        • operator surface audience_admin_*       → RLS denies (401/403/404)
#        • the member is provisioned in aisha_auth.users (id == JWT.sub)
#
# Needs a LIVE stack (source + broker + aisha gateway + db + Mailhog), so it is
# NOT run in pure CI — its static CONTRACT is locked by
# src/tests/gates/federation-login-contract.gate.test.ts, and the live run is
# the guarded e2e. Run it by hand against a warmed stack:
#
#   SOURCE_EMAIL=member@source.test ./scripts/local/federation-login.sh
# =============================================================================
set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
BROKER_URL="${BROKER_URL:-http://localhost:8088}"          # svc-source-broker
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3001}"        # aisha PostgREST gateway
MAILHOG_URL="${MAILHOG_URL:-http://localhost:8025}"        # Mailhog HTTP API (8025)
PGURL="${AISHA_DB_URL:-postgresql://postgres:postgres@127.0.0.1:57422/postgres}"
SOURCE_EMAIL="${SOURCE_EMAIL:-member@source.test}"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
jqr()  { jq -re "$@"; }

command -v jq   >/dev/null || die "jq is required"
command -v curl >/dev/null || die "curl is required"

# ── 1. Start onboarding — get the onboardingToken ────────────────────────────
say "POST /auth/source/start for $SOURCE_EMAIL"
START_JSON="$(curl -fsS -X POST "$BROKER_URL/auth/source/start" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$SOURCE_EMAIL\"}")" || die "broker /auth/source/start failed"
onboardingToken="$(printf '%s' "$START_JSON" | jqr '.onboardingToken')" \
  || die "no onboardingToken in start response"
ok "onboardingToken received"

# ── 2. Read the OTP from Mailhog ─────────────────────────────────────────────
# Robust extractor: pull the message body and grab the 6-digit/word code that
# the source app presents next to its precise phrasing ("one-time password" /
# "directly in the app") — NOT the naive "first uppercase word" grab, which used
# to pick up MIME boundaries, ACME, or hex colour codes (FFFFFF).
say "Reading the one-time password from Mailhog"
sleep 1
MH_BODY="$(curl -fsS "$MAILHOG_URL/api/v2/search?kind=to&query=$SOURCE_EMAIL" \
  | jq -r '.items[0].Content.Body // ""' \
  | sed 's/=\r\?$//' | tr -d '\r')" || die "Mailhog query failed"
[ -n "$MH_BODY" ] || die "no OTP email for $SOURCE_EMAIL in Mailhog (8025)"
# The source mailer presents the OTP INLINE right after the phrase "directly in
# the app" — a short pronounceable code (e.g. "…directly in the app XIFU"), or on
# older templates a numeric code after a colon ("…in the app): 482913"). Grab the
# first 4-8 char alnum token that follows that phrase and upper-case it. (The old
# grep grabbed [A-Z0-9]{6,8}, which MISSED the 4-char code and matched the app name
# from the "LOG IN TO <APP>" button instead.)
CODE="$(printf '%s\n' "$MH_BODY" \
  | sed -n -E 's/.*directly in the app[^A-Za-z0-9]*([A-Za-z0-9]{4,8}).*/\1/p' \
  | head -1 | tr '[:lower:]' '[:upper:]')"
[ -n "$CODE" ] || die "could not extract the OTP code from the email body"
ok "OTP extracted: ${CODE:0:2}**** "

# ── 3. Login — mint the scoped aisha session token ───────────────────────────
say "POST /auth/source/login (consume the OTP \$CODE)"
LOGIN_JSON="$(curl -fsS -X POST "$BROKER_URL/auth/source/login" \
  -H 'content-type: application/json' \
  -d "{\"onboardingToken\":\"$onboardingToken\",\"code\":\"$CODE\"}")" \
  || die "broker /auth/source/login failed"
aishaToken="$(printf '%s' "$LOGIN_JSON" | jqr '.aishaToken')" \
  || die "login did not return an aishaToken"
ok "aishaToken minted"

# ── 4. Decode + assert the federated, least-privilege claims ─────────────────
say "Decoding aishaToken claims"
payload_b64="$(printf '%s' "$aishaToken" | cut -d. -f2)"
# base64url → base64, pad, decode
pad=$(( (4 - ${#payload_b64} % 4) % 4 )); payload_b64="${payload_b64}$(printf '%*s' "$pad" '' | tr ' ' '=')"
CLAIMS="$(printf '%s' "$payload_b64" | tr '_-' '/+' | base64 -d 2>/dev/null)" \
  || die "could not base64-decode the JWT payload"
[ "$(printf '%s' "$CLAIMS" | jqr '.source_member')" = "true" ] \
  || die "token is NOT a federated source_member session (operator leak!)"
[ "$(printf '%s' "$CLAIMS" | jqr '.federated_from')" = "source-api" ] \
  || die "federated_from claim missing/wrong"
[ "$(printf '%s' "$CLAIMS" | jqr '.role')" = "authenticated" ] \
  || die "token role must be 'authenticated' (least privilege), not operator"
SUB="$(printf '%s' "$CLAIMS" | jqr '.sub')"
ok "claims OK — source_member=true, federated_from=source-api, sub=$SUB"

AUTH=(-H "Authorization: Bearer $aishaToken")

# ── 5a. Self-scope RPC — the member sees ONLY their own tier ─────────────────
say "Self-scope: audience_get_my_tier"
TIER="$(curl -fsS -X POST "$GATEWAY_URL/rest/v1/rpc/audience_get_my_tier" \
  "${AUTH[@]}" -H 'content-type: application/json' -d '{}')" \
  || die "audience_get_my_tier failed for a federated member"
ok "member tier resolved (self-scope): $(printf '%s' "$TIER" | head -c 80)"

# ── 5b. Operator surface MUST be denied to a plain member (RLS) ──────────────
say "RLS denial: an operator-only audience_admin_ surface must NOT return data"
ADMIN_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$GATEWAY_URL/rest/v1/rpc/audience_admin_assign_actors" \
  "${AUTH[@]}" -H 'content-type: application/json' -d '{}')"
case "$ADMIN_STATUS" in
  401|403|404) ok "operator surface denied (HTTP $ADMIN_STATUS) — RLS holds" ;;
  *) die "operator surface audience_admin_assign_actors returned $ADMIN_STATUS — RLS LEAK" ;;
esac

# ── 5c. The member is provisioned in aisha_auth.users (id == JWT.sub) ────────
say "Provisioning: member exists in aisha_auth.users with id == JWT.sub"
DB_ID="$(psql "$PGURL" -tAc \
  "SELECT id FROM aisha_auth.users WHERE email='${SOURCE_EMAIL//\'/\'\'}' LIMIT 1")" \
  || die "could not query aisha_auth.users"
[ -n "$DB_ID" ] || die "member not provisioned into aisha_auth.users"
[ "$DB_ID" = "$SUB" ] || die "aisha_auth.users.id ($DB_ID) != JWT.sub ($SUB)"
ok "member provisioned — aisha_auth.users.id == JWT.sub"

say "FEDERATED LOGIN OK — scoped source_member session proven end-to-end."
