#!/bin/sh
# =============================================================================
# pki-renewer.sh — unified internal mesh-cert issuer + distributor
# =============================================================================
# Runs as the `aisha-pki-renewer` sidecar INSIDE the aisha-pki stack, co-located
# with pki-bridge + OpenXPKI. It is the single owner of the *.mesh.<tld> cert
# lifecycle for the whole platform:
#
#   for each RENEW_SERVICE:
#     1. check the consumer's current cert (read from its Coolify env) — skip if
#        still valid for > RENEW_THRESHOLD_DAYS (no needless churn / restarts)
#     2. otherwise: acquire a Keycloak token via CLIENT-CREDENTIALS (M2M service
#        account — no bootstrap user/password), POST pki-bridge /v1/issue
#     3. base64 the returned cert + private key and PATCH them into the consuming
#        app's Coolify env (is_literal — preserves PEM), then restart that app so
#        its TLS terminator reloads.
#
# Security posture (why this shape):
#   - Auth is OAuth2 client_credentials against a dedicated confidential service
#     client (PKI_ISSUER_CLIENT_ID, aud=pki-proxy) — no human/ROPC user, no
#     password grant, least-privilege audience.
#   - pki-bridge is reached over the local compose network. KC is reached over
#     PUBLIC DNS (edge Traefik, publicly-trusted LE cert) — NOT the internal
#     http://aisha-keycloak:80 face. That internal face was the original design and
#     is named here only because it keeps re-presenting itself as the obvious fix;
#     it is not one. See the KEYCLOAK_URL contract below, and the gate that pins
#     it: src/tests/gates/pki-renewer-kc-public-dns.gate.test.ts.
#     netbird (and other consumers) need ZERO cross-server or mesh reachability —
#     they only consume the delivered env cert.
#   - The private key transits only the internal network (pki-bridge -> this
#     sidecar -> Coolify API over the same host); it is stored is_literal so the
#     PEM is never mangled.  (Future hardening: CSR-on-consumer so the key never
#     transits — tracked separately.)
#
# Required env:
#   KEYCLOAK_URL              PUBLIC KC base (https://<KEYCLOAK_DOMAIN_PUBLIC>) — public
#                            DNS → edge Traefik → KC, over the publicly-trusted LE cert.
#                            KC has a FIXED frontend issuer, so the token `iss` is the
#                            public issuer no matter which face answers and pki-bridge's
#                            expected-iss check still matches (measured 2026-07-20).
#
#                            Do NOT "fix" this to the internal http://aisha-keycloak:80
#                            alias, and do NOT add an extra_hosts host-gateway pin.
#                            Incident 2026-07-17: the renewer pinned the KC host to
#                            host-gateway, whose :443 serves Traefik's SELF-SIGNED default
#                            cert whenever aisha-pki is not co-located with the backend
#                            Traefik. TLS verify rejected it → token acquisition failed
#                            every cycle → no *.mesh cert → netbird agents failed the mesh
#                            gRPC handshake → four stacks stayed unhealthy. Public DNS was
#                            then verified in prod: HTTP 200 + a valid token.
#                            Pinned by src/tests/gates/pki-renewer-kc-public-dns.gate.test.ts.
#   KEYCLOAK_REALM
#   PKI_ISSUER_CLIENT_ID      confidential service-account client (default aisha-pki-issuer)
#   PKI_ISSUER_CLIENT_SECRET  its client secret (from Keycloak, provisioned at cold-start)
#   PKI_BRIDGE_URL            default http://aisha-pki-bridge:3040
#   AISHA_COOLIFY_API_URL     Coolify CONTROL-PLANE url (e.g. https://coolify.example)
#                             — NOT COOLIFY_URL, which Coolify overwrites in every
#                               container with that app's own FQDN
#   COOLIFY_API               <host>/api/v1 (explicit override; else derived above)
#   COOLIFY_API_TOKEN
#   RENEW_SERVICES            comma list of mesh hostnames (e.g. "core.mesh.aisha.internal,netbird.mesh.aisha.internal")
#   RENEW_INTERVAL_HOURS      default 6
#   RENEW_THRESHOLD_DAYS      default 21
# =============================================================================
set -eu

: "${KEYCLOAK_URL:?KEYCLOAK_URL required (routable KC base)}"
: "${KEYCLOAK_REALM:?KEYCLOAK_REALM required}"
: "${PKI_ISSUER_CLIENT_ID:=aisha-pki-issuer}"
# NOT a hard :? guard. PKI_ISSUER_CLIENT_SECRET is provisioned by the KC
# bootstrap (aisha-bootstrap-user-init.sh Step 10b), which runs AFTER Keycloak
# comes up — but aisha-pki (this sidecar's stack) deploys in an EARLIER cold-start
# wave. A missing secret at container start is a transient bootstrap state, NOT a
# fatal config error. Hard-exiting here (set -eu + :?) meant the renewer died
# before touching /tmp/pki-renewer-alive, so its healthcheck never passed and the
# WHOLE aisha-pki app (OpenXPKI CA + pki-bridge) was dragged to unhealthy — which
# in turn blocked the cold-start wave-4 gate. Instead: default to empty, stay
# alive, and short-poll until the secret + KC client exist (see the main loop).
: "${PKI_ISSUER_CLIENT_SECRET:=}"
# ⛔ Identita instance se NEDOSAZUJE — týž zákon, jaký tenhle soubor vyslovuje
# o pár řádků níž u certifikátů. Holé `pki-bridge` je na sdíleném hostiteli
# adresa bez vlastníka; odhadnutý prefix míří na cizí PKI. Bez identity zůstane
# prázdno a hlavní smyčka krátce polluje, přesně jako u chybějícího secretu výš.
if [ -n "${APP_NAME_PREFIX:-}" ]; then
  : "${PKI_BRIDGE_URL:=http://${APP_NAME_PREFIX}-pki-bridge:3040}"
else
  : "${PKI_BRIDGE_URL:=}"
fi
# Coolify API base. NEVER derive this from COOLIFY_URL: Coolify injects that
# name into every container set to THAT APP's own FQDN (together with
# COOLIFY_FQDN / COOLIFY_RESOURCE_UUID / COOLIFY_CONTAINER_NAME), so in-container
# it is the app describing itself, never the master. A previous revision of this
# block claimed the runtime value WAS the master and preferred it — assumed, not
# measured, and false: it is the app's own generated host
# (http://<app-uuid>.<host-ip>.sslip.io), so every /applications lookup 404'd and
# app_uuid_by_name returned empty for EVERY consumer. The failure surfaced only
# as "consumer app <prefix>-netbird not found in Coolify", which reads like a
# naming problem and hid a wrong-host problem for a day.
#
# AISHA_COOLIFY_API_URL carries the control-plane URL in OUR namespace, where the
# platform has no reason to write. COOLIFY_API stays an explicit override for
# operators who set it directly.
: "${COOLIFY_API:=${AISHA_COOLIFY_API_URL:+${AISHA_COOLIFY_API_URL%/}/api/v1}}"
: "${COOLIFY_API:?COOLIFY_API required — set AISHA_COOLIFY_API_URL to the Coolify CONTROL-PLANE url (not COOLIFY_URL, which Coolify overwrites per-app)}"
: "${COOLIFY_API_TOKEN:?COOLIFY_API_TOKEN required}"
: "${RENEW_SERVICES:?RENEW_SERVICES required (comma list of mesh hostnames)}"
: "${RENEW_INTERVAL_HOURS:=6}"
: "${RENEW_THRESHOLD_DAYS:=21}"
# During cold-start, poll on this SHORT interval until the first fully-successful
# cycle (secret provisioned, KC client live, pki-bridge up, consumers deployed)
# so the mesh cert is delivered within minutes, not after the 6h steady cadence.
: "${BOOTSTRAP_POLL_SECONDS:=60}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

# --- fingerprint a secret for correlation without leaking it -----------------
fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }

# --- consumer registry: mesh hostname -> "<coolify-app-name> <cert-env> <key-env>"
# UUIDs are DERIVED by name at runtime (never hardcoded — forkable + drift-proof).
# A hostname with no consumer here is issued but not distributed (e.g. certs a
# service reads from a shared volume rather than env).
consumer_for() {
  # Bez identity instance se jméno appky složit NEDÁ a dosadit ji nesmíme: na
  # sdíleném Coolify by `aisha-netbird` byla CIZÍ produkce a renewer by jí zapsal
  # do env privátní klíč. Do 2026-08-09 tu stálo `${APP_NAME_PREFIX:-aisha}`,
  # tedy přesně to dosazení.
  #
  # Chybějící identita ale NESMÍ shodit proces: démon musí dál sahat na
  # /tmp/pki-renewer-alive, jinak jde celá aisha-pki do unhealthy a zablokuje
  # vlnu 4 cold-startu — táž úvaha, proč PKI_ISSUER_CLIENT_SECRET nemá tvrdý
  # `:?` guard (viz komentář u něj). Selže tedy PRÁCE, ne běh: prázdný consumer
  # znamená „vydáno, ale nedistribuováno", což je tu podporovaný výsledek.
  #
  # Diagnostika jde na stderr, NE přes log(): stdout téhle funkce je její
  # návratová hodnota a hláška by se do ní vlepila.
  if [ -z "${APP_NAME_PREFIX:-}" ]; then
    printf '[pki-renewer] WARN: APP_NAME_PREFIX není nastaven — cert pro %s se VYDÁ, ale NEDORUČÍ. Identita instance se nedosazuje; deklaruj ji v env stacku.\n' "$1" >&2
    echo ""
    return 0
  fi
  case "$1" in
    netbird.*) echo "${APP_NAME_PREFIX}-netbird NETBIRD_INTERNAL_CERT_B64 NETBIRD_INTERNAL_KEY_B64" ;;
    *)         echo "" ;;
  esac
}

# --- resolve a Coolify application UUID by its name (no hardcoded UUIDs) ------
app_uuid_by_name() {
  curl -fsS --max-time 20 -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_API}/applications" 2>/dev/null \
    | jq -r --arg n "$1" '.[] | select(.name==$n) | .uuid' | head -1
}

# --- read the consumer's current cert PEM from its Coolify env (or empty) -----
current_cert_pem() {
  # $1 = app uuid, $2 = cert env key
  # The value comes from coolify_env_hodnota (below): production row only, and
  # `real_value` DECODED from its .env rendering. Reading `real_value` raw is what
  # made the skip-check see an empty cert and deliver+restart every cycle.
  #
  # Returns 2 — distinct from "empty" — when the API read itself fails. Callers
  # MUST distinguish the two: "the consumer holds nothing" is a fact to act on,
  # "I could not ask" is not. Collapsing them meant a Coolify blip looked exactly
  # like a missing cert, and since a missing cert now triggers deliver+restart,
  # that would restart the consumer on every cycle for as long as the API misbehaved.
  _envs_json="$(curl -fsS --max-time 20 -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_API}/applications/$1/envs" 2>/dev/null)" || return 2
  printf '%s' "$_envs_json" | coolify_env_hodnota "$2" \
    | tr -d '\r\n' | base64 -d 2>/dev/null || true
}

# --- skutečná hodnota PRODUKČNÍ proměnné $1 z odpovědi Coolify /envs (stdin) ---
# ⛔ NAMĚŘENO 2026-09-18 (guru): `real_value` není hodnota, ale její tvar pro .env
# (Coolify 4.3.16 EnvironmentVariable::realValue) — literál/multiline obalí `'…'`,
# ostatní projde escapeEnvVariables. patch_env píše is_literal:true, takže čtení
# dostávalo `'LS0t…='`; `base64 -d` na apostrofu selhal, prázdno znamenalo
# „konzument nemá certifikát" a NetBird se restartoval každých 6 h a při každém
# startu PKI. Čte se navíc jen produkční řádek (patch_env píše is_preview:false),
# ne „první v odpovědi". Zrcadlo scripts/lib/coolify-env-hodnota.mjs — obě
# prochází týmiž vektory v scripts/lib/coolify-env-hodnota.test.mjs.
coolify_env_hodnota() {
  jq -r --arg k "$1" '
    def odescapuj: gsub("\\\\(?<c>.)"; if .c == "r" then "\r" elif .c == "t" then "\t" elif .c == "0" then "\u0000" else .c end);
    def json_kontejner: (startswith("{") or startswith("[")) and ((try fromjson catch null) != null);
    [ (if type == "array" then . else .data end)[]? | select(.key == $k and .is_preview != true) ] | first
    | if . == null then empty else
        (.real_value // "") as $r | (.value // "") as $v
        | if ($r | length) == 0 then $v
          elif ($r | json_kontejner) then $r
          elif (.is_literal == true or .is_multiline == true) then
            ($r | if length >= 2 and startswith("'"'"'") and endswith("'"'"'") then .[1:-1] else . end)
          else ($r | odescapuj) end
      end'
}

# --- is a PEM cert (stdin) still valid beyond RENEW_THRESHOLD_DAYS? ------------
# Uses openssl -checkend (portable; avoids busybox `date -d` which cannot parse
# openssl's "MMM DD HH:MM:SS YYYY GMT" notAfter format). Returns 0 = still valid.
cert_valid_beyond_threshold() {
  openssl x509 -checkend "$(( RENEW_THRESHOLD_DAYS * 86400 ))" -noout >/dev/null 2>&1
}

# --- file delivery on THIS container's pki-certs volume -----------------------
# Reuses the layout issue-netbird-mesh-cert.sh already established:
#   /certs/pki/<slug>/{cert.pem,key.pem}   (e.g. /certs/pki/netbird-mesh/)
# Same directory, same filenames, so the two issuers (that per-deploy script,
# this continuous renewer) agree on one freshness source per stack.
#
# NOT a cluster-wide share, despite the volume being spelled `pki-certs` in every
# compose. Coolify names volumes per APPLICATION UUID and each stack declares its
# own `name: aisha_<stack>-pki-certs`, so:
#   this sidecar (aisha-pki)  <uuid-A>_pki-certs -> /certs/pki
#   netbird-internal-tls      <uuid-B>_pki-certs -> /ca
# are two different disks wearing the same name. A file written here is visible
# ONLY to containers in this same stack. Everything cross-stack — netbird above
# all — is delivered by env (patch_env → Coolify API), which is also the only
# path that crosses nodes.
#
# This is also the fix for hostnames with no env consumer: core.<mesh-tld> was
# issued and then DISCARDED every cycle, because this container had no volume at
# all.
: "${PKI_CERTS_DIR:=/certs/pki}"

# hostname → volume slug, mirroring consumer_for()'s hostname → app mapping.
# A hostname with no slug gets no file delivery (env-only consumer).
# --- extra SANs per hostname, mirroring consumer_for()/cert_dir_for() ---------
# The two issuers of the SAME cert must ask for the SAME SANs, or whichever one
# ran last silently changes what the cert covers. infra/pki/issue-netbird-mesh-cert.sh
# requests four (host + netbird-internal-tls,netbird-signal,netbird-management)
# while this file used to request one — and the consumer prefers the env cert
# THIS file delivers (docker-compose.coolify-netbird.yml: env branch before the
# volume branch), so a renewal quietly downgraded a 4-SAN cert to 1-SAN.
extra_sans_for() {
  case "$1" in
    netbird.*) echo "${NETBIRD_MESH_EXTRA_SANS:-netbird-internal-tls,netbird-signal,netbird-management}" ;;
    *)         echo "" ;;
  esac
}

cert_dir_for() {
  case "$1" in
    netbird.*) printf '%s/netbird-mesh' "$PKI_CERTS_DIR" ;;
    core.*)    printf '%s/core-mesh' "$PKI_CERTS_DIR" ;;
    *)         printf '' ;;
  esac
}

file_cert_valid_beyond_threshold() {
  _d="$(cert_dir_for "$1")"
  [ -n "$_d" ] && [ -f "${_d}/cert.pem" ] || return 1
  cert_valid_beyond_threshold < "${_d}/cert.pem"
}

# --- do this cert and this key belong together? -------------------------------
# Compares public keys rather than RSA moduli, so it holds for EC leaves too.
# Only the reuse path needs this: a freshly issued pair comes from one bridge
# response, but the two files on disk are read independently and a half-finished
# or hand-touched directory can pair a cert with a foreign key. Delivering such a
# pair would take the consumer's TLS down and — because the env cert is
# date-valid — the consumer-freshness skip would then keep it down every cycle.
cert_key_pair_matches() {
  _pk_cert="$(printf '%s\n' "$1" | openssl x509 -noout -pubkey 2>/dev/null || true)"
  _pk_key="$(printf '%s\n' "$2" | openssl pkey -pubout 2>/dev/null || true)"
  [ -n "$_pk_cert" ] && [ "$_pk_cert" = "$_pk_key" ]
}

# --- is this cert actually FOR this hostname? ---------------------------------
# The reuse path must check identity, not just dates. cert_dir_for() maps by
# hostname PREFIX (netbird.* -> netbird-mesh), so after a MESH_TLD change the
# directory still resolves while the cert inside it carries the OLD FQDN. Date
# validity would happily pass it. Pre-fix such a cert stayed local and harmless;
# now it would be pushed into the consumer's env, so it has to be verified here.
cert_covers_hostname() {
  _txt="$(printf '%s\n' "$1" | openssl x509 -noout -text 2>/dev/null || true)"
  [ -n "$_txt" ] || return 1
  _h_re="$(printf '%s' "$2" | sed 's/[.[\*^$]/\\&/g')"
  # SAN is authoritative; CN is the legacy fallback for leaves without a SAN.
  printf '%s' "$_txt" | grep -qE "DNS:${_h_re}([,[:space:]]|$)" && return 0
  printf '%s' "$_txt" | grep -qE "CN[[:space:]]*=[[:space:]]*${_h_re}([,[:space:]]|$)" && return 0
  return 1
}

# Atomic (tmp + mv) so a consumer never reads a half-written file. Non-fatal: a
# read-only or absent volume must not stop issuance or env delivery.
persist_issued_cert() {
  _h="$1"; _cert="$2"; _key="$3"
  _d="$(cert_dir_for "$_h")"
  [ -n "$_d" ] || return 0
  if ! mkdir -p "$_d" 2>/dev/null; then
    log "  WARN: cannot write ${_d} — cert not persisted (will re-issue next cycle)"
    return 1
  fi
  printf '%s' "$_cert" > "${_d}/cert.pem.tmp" && mv "${_d}/cert.pem.tmp" "${_d}/cert.pem"
  printf '%s' "$_key"  > "${_d}/key.pem.tmp"  && chmod 600 "${_d}/key.pem.tmp" && mv "${_d}/key.pem.tmp" "${_d}/key.pem"
  log "  persisted to ${_d} (cert.pem/key.pem)"
}

# --- acquire a client_credentials access token (aud=pki-proxy) ----------------
# The client secret is fed to curl from a 0600 temp file via --data-urlencode
# "name@file" (curl url-encodes the file CONTENT as the field value) so it never
# appears on the process argv (/proc/<pid>/cmdline). grant_type/client_id are
# non-sensitive and stay on argv.
# Deliberately NOT `curl -f`, and stderr is NOT sent to /dev/null. Both used to be
# here, and together they erased the only evidence of WHY a cycle failed: -f discards
# the 4xx BODY, which is where Keycloak says `invalid_client` (absent client, or a
# secret that disagrees with the realm's), and 2>/dev/null discarded curl's own
# transport errors (DNS failure, TLS reject, timeout). Every distinct cause collapsed
# into one indistinguishable "token acquisition failed" line.
#
# That is not a cosmetic logging gap. During the 2026-07-29 mesh outage this line was
# the whole evidence base, and "unreachable" vs "refused" are opposite fixes —
# a topology change vs a secret re-sync. It invited a wrong diagnosis (see the
# KEYCLOAK_URL contract above, which is what an "unreachable" reading argues for).
#
# Diagnostics go to STDERR on purpose: the caller runs this as `token="$(get_token)"`,
# so anything on stdout would be captured into the token itself.
get_token() {
  secfile="$(mktemp)"; chmod 600 "$secfile"
  printf '%s' "$PKI_ISSUER_CLIENT_SECRET" > "$secfile"
  # -w appends the status on its own trailing line; 2>&1 folds curl's transport
  # error text into the same capture. `|| true` keeps set -e from aborting the loop
  # — a failed cycle must retry, not kill the renewer (its healthcheck depends on
  # staying alive).
  _resp="$(curl -sS --max-time 20 -w '\n%{http_code}' \
    --data grant_type=client_credentials \
    --data "client_id=${PKI_ISSUER_CLIENT_ID}" \
    --data-urlencode "client_secret@${secfile}" \
    "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" 2>&1)" || true
  rm -f "$secfile"

  _code="$(printf '%s' "$_resp" | tail -n 1)"
  _body="$(printf '%s' "$_resp" | sed '$d')"

  case "${_code:-}" in
    200)
      printf '%s' "$_body" | jq -r '.access_token // empty'
      ;;
    # 000 = curl never got a response. Treating it as an HTTP status is the
    # "tool failure read as data" trap: it is the absence of a measurement.
    000 | '' | *[!0-9]*)
      log "  token endpoint UNREACHABLE (kc=${KEYCLOAK_URL}) — no HTTP response: $(printf '%s' "$_body" | tr '\n' ' ' | cut -c1-200)" >&2
      ;;
    *)
      # KC answered and refused. Log ONLY the machine-readable `.error` (invalid_client,
      # unauthorized_client, …) — that is the field that actually separates the causes.
      # `.error_description` is upstream-controlled free text and is deliberately NOT
      # echoed: whatever the endpoint puts there would land verbatim in a log that gets
      # shipped around. The secret is correlated by FINGERPRINT instead, which lets you
      # compare renewer vs Keycloak without either side disclosing it.
      log "  token endpoint REFUSED HTTP ${_code} (kc=${KEYCLOAK_URL}, client=${PKI_ISSUER_CLIENT_ID}, secret_fp=$(fp "$PKI_ISSUER_CLIENT_SECRET")): $(printf '%s' "$_body" | jq -r '.error // "no error code in body"' 2>/dev/null | tr -d '\n' | cut -c1-80)" >&2
      ;;
  esac
}

# --- PATCH a single env var onto a Coolify app (is_literal preserves PEM) ------
patch_env() {
  # $1 uuid, $2 key, $3 value
  local body code
  body="$(jq -n --arg k "$2" --arg v "$3" '{data:[{key:$k, value:$v, is_preview:false, is_literal:true}]}')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
    -X PATCH -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    -H "Content-Type: application/json" -d "$body" \
    "${COOLIFY_API}/applications/$1/envs/bulk" 2>/dev/null)"
  echo "$code"
}

# --- restart a Coolify app so it reloads the new cert -------------------------
restart_app() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
    -X POST -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_API}/applications/$1/restart" 2>/dev/null || true
}

# --- force-REDEPLOY a Coolify app (not restart) -------------------------------
# A restart re-reads the SAME stale volume bundle because every consumer pki-init
# is restart:"no". A force redeploy RE-RUNS pki-init (fresh CA bundle) AND
# recreates the netbird-agent (which caches its x509 pool at process start).
# Used ONLY on a CA-ROOT rotation (see the watcher in the main loop).
redeploy_app() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 60 \
    -X POST -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_API}/deploy?uuid=$1&force=true" 2>/dev/null || true
}

# --- current AISHA CA-root fingerprint from the live bundle (or empty) ---------
ca_root_fp() {
  curl -fsS --max-time 20 "${PKI_BRIDGE_URL%/}/diag/ca-bundle" 2>/dev/null | fp 2>/dev/null || true
}

# --- bundle-consumer registry: stacks whose netbird-agent trusts the CA via a
# VOLUME bundle their one-shot pki-init writes (NOT an env cert like netbird's
# internal-tls). On a CA-root rotation these must be force-redeployed so pki-init
# re-pulls the fresh bundle and the agent is recreated. Roles → app names by
# APP_NAME_PREFIX (never hardcoded — forkable + drift-proof, like consumer_for()).
# ⛔ Tady stal RUCNI seznam jako VYCHOZI hodnota. Promennou nikdo nikde
# nenastavoval, takze tech 6 roli BYLO tou hodnotou ve 100 % behu -- zatimco
# odvozeni z katalogu jich najde 21. Chybel mimo jine `pki` SAM, jehoz agent
# tak po rotaci koorene nikdy nedostal nove kotvy; protoze pki je TVRDA brana,
# zastavilo to 27 aplikaci vcetne databaze (2026-08-22). `netbird` tam naopak
# byl navic -- komentar o dva radky vys sam rika, ze pouziva env certifikat.
# Hodnotu doruci compose z odvozeni; prazdna znamena ZASTAVIT, ne hadat.
BUNDLE_CONSUMER_ROLES="${BUNDLE_CONSUMER_ROLES:-}"   # stráženo U POUŽITÍ, viz níž

# --- issue + distribute one service -------------------------------------------
process_service() {
  hostname="$1"
  log "── ${hostname} ──"

  # Transient bootstrap gate: the KC client secret is provisioned after Keycloak
  # + bootstrap come up (a later cold-start wave). Until then, stay alive and
  # signal not-ready so the caller keeps short-polling — never issue with an
  # empty secret (which would just fail token acquisition with a noisier error).
  if [ -z "$PKI_ISSUER_CLIENT_SECRET" ]; then
    log "  WAIT: PKI_ISSUER_CLIENT_SECRET not provisioned yet (KC bootstrap pending) — retry next cycle"
    return 1
  fi

  set -- $(consumer_for "$hostname")
  app_name="${1:-}"; cert_key="${2:-}"; key_key="${3:-}"

  # 1. skip if a cert valid past the threshold already exists.
  #
  # The freshness check MUST cover every hostname, not just the ones with an env
  # consumer. It used to live inside `if [ -n "$app_name" ]`, so a hostname whose
  # consumer_for() returns nothing (core.${MESH_TLD}) skipped the check entirely
  # and was RE-ISSUED EVERY CYCLE FOREVER — even with the previous cert valid for
  # another 89 days. Every issue queues a revocation of the cert it supersedes
  # (certificate_enroll REVOKE_CERTS), which is what produced 167k stuck
  # revocation workflows and pinned the host at load 130 on 2026-07-17.
  #
  # This is topology-independent: true on one node, N nodes, multi-cloud, and
  # with the mesh on or off. No flag, no exception.
  uuid=""
  if [ -n "$app_name" ]; then
    uuid="$(app_uuid_by_name "$app_name")"
    [ -z "$uuid" ] && log "  WARN: consumer app '$app_name' not found in Coolify — cannot distribute"
  fi

  # FORCE_REISSUE (CA-root rotation this cycle) bypasses BOTH skips: a leaf still
  # date-valid but signed by the now-REPLACED root would otherwise be kept, leaving
  # internal-tls serving a cert that no longer chains to the refreshed bundle.
  # Read the consumer's state ONCE, into a variable, so the read's exit status is
  # not swallowed by a pipeline (a pipeline reports only its LAST command).
  consumer_pem=""
  if [ -n "$uuid" ]; then
    if ! consumer_pem="$(current_cert_pem "$uuid" "$cert_key")"; then
      log "  WARN: cannot read consumer env for '${app_name}' (Coolify API) — state UNKNOWN, not guessing; retry next cycle"
      return 1
    fi
  fi

  # A delivery whose reload never happened leaves a marker; until it clears, the
  # consumer-freshness check below must NOT be trusted. Without this the skip is
  # self-sealing: cycle 1 PATCHes the env and fails to restart, cycle 2 reads back
  # cycle 1's OWN WRITE, concludes "valid — skip", and the consumer serves the old
  # cert forever with every log line green. (Measured over 4 cycles: exactly one
  # restart was ever attempted.) The marker sits on this container's own volume,
  # which is legitimate here precisely because it records THIS process's unfinished
  # action — not the consumer's state, which local disk can never testify to.
  reload_pending=0
  _rl="$(cert_dir_for "$hostname")"
  [ -n "$_rl" ] && [ -f "${_rl}/.reload-pending" ] && reload_pending=1

  if [ "${FORCE_REISSUE:-0}" != "1" ] && [ "$reload_pending" = "0" ] && [ -n "$uuid" ] && \
     printf '%s' "$consumer_pem" | cert_valid_beyond_threshold; then
    log "  consumer cert valid beyond ${RENEW_THRESHOLD_DAYS}d — skip"
    return 0
  fi
  [ "$reload_pending" = "1" ] && \
    log "  previous delivery was never loaded (restart had failed) — redelivering"

  # The local-volume check answers "must I MINT a new cert?" — never "did the
  # consumer GET one?". Those are different questions, and conflating them is
  # what took the mesh down on 2026-07-20:
  #
  #   this container   <app-uuid-A>_pki-certs -> /certs/pki   cert.pem present
  #   netbird-int-tls  <app-uuid-B>_pki-certs -> /ca          EMPTY
  #
  # Coolify names volumes per APPLICATION UUID and every stack declares its own
  # `name: aisha_<stack>-pki-certs`, so the volume this sidecar writes is NOT the
  # volume the consumer reads. The old code returned 0 here, which meant the
  # SECOND gate vetoed the FIRST: gate 1 had just proven the consumer holds no
  # cert, and gate 2 answered "but I have a copy" and delivered nothing — by
  # either path. netbird-internal-tls then fell back to self-signed and every
  # agent failed TLS against management, signal and relay.
  #
  # Freshness of our OWN copy is not evidence of delivery. So: reuse the local
  # cert (no needless issuance — every issue queues a revocation, see above) and
  # fall through to the DISTRIBUTION step below.
  reuse_cert=""; reuse_key=""
  if [ "${FORCE_REISSUE:-0}" != "1" ] && file_cert_valid_beyond_threshold "$hostname"; then
    if [ -z "$app_name" ]; then
      log "  cert on local volume valid beyond ${RENEW_THRESHOLD_DAYS}d, no env consumer — skip"
      return 0
    fi
    _rd="$(cert_dir_for "$hostname")"
    reuse_cert="$(cat "${_rd}/cert.pem" 2>/dev/null || true)"
    reuse_key="$(cat "${_rd}/key.pem" 2>/dev/null || true)"
    if [ -z "$reuse_cert" ] || [ -z "$reuse_key" ]; then
      reuse_cert=""; reuse_key=""
      log "  WARN: local cert valid but cert/key unreadable — falling through to re-issue"
    elif ! cert_covers_hostname "$reuse_cert" "$hostname"; then
      reuse_cert=""; reuse_key=""
      log "  WARN: local cert does not cover ${hostname} (stale CN/SAN) — falling through to re-issue"
    elif ! cert_key_pair_matches "$reuse_cert" "$reuse_key"; then
      # Non-empty is not enough: shipping a mismatched pair would break the
      # consumer's TLS, and the delivered cert would still be date-valid, so the
      # consumer-freshness skip above would keep it broken every cycle after.
      reuse_cert=""; reuse_key=""
      log "  WARN: local cert and key do not match (public keys differ) — falling through to re-issue"
    else
      log "  local cert valid beyond ${RENEW_THRESHOLD_DAYS}d but consumer has NONE — reusing it, delivering to env (no re-issue)"
    fi
  fi

  [ "${FORCE_REISSUE:-0}" = "1" ] && log "  CA-root rotated — forcing re-issue (skip bypassed)"
  [ -z "$reuse_cert" ] && log "  no cert valid beyond ${RENEW_THRESHOLD_DAYS}d — (re)issue"

  if [ -n "$reuse_cert" ]; then
    # Reuse path: a valid cert already exists on this container's volume; the
    # consumer is what is missing it. Skip minting (and its queued revocation)
    # and go straight to distribution.
    cert="$reuse_cert"; key="$reuse_key"; certid="reused-from-local-volume"
  else
    # 2. client_credentials token
    token="$(get_token)"
    if [ -z "$token" ]; then
      log "  ERROR: client_credentials token acquisition failed (client=${PKI_ISSUER_CLIENT_ID}, kc=${KEYCLOAK_URL})"
      return 1
    fi
    log "  token acquired (client=${PKI_ISSUER_CLIENT_ID})"

    # 3. issue via pki-bridge (capture status; -f hides bodies on 4xx/5xx)
    resp="$(curl -sS --max-time 40 -w '\n%{http_code}' -X POST \
      -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
      -d "$(jq -n --arg h "$hostname" --arg x "$(extra_sans_for "$hostname")" \
            '{hostname:$h, sans:(([$h] + ($x | split(","))) | map(select(. != "")) | unique), comment:"issued by pki-renewer (unified)"}')" \
      "${PKI_BRIDGE_URL}/v1/issue" 2>/dev/null)"
    status="$(echo "$resp" | tail -1)"
    bodyj="$(echo "$resp" | sed '$d')"
    if [ "$status" != "200" ] && [ "$status" != "201" ]; then
      log "  ERROR: pki-bridge HTTP ${status}: $(echo "$bodyj" | head -c 240)"
      return 1
    fi
    cert="$(echo "$bodyj" | jq -r '.certificate // empty')"
    key="$(echo "$bodyj" | jq -r '.privateKey // empty')"
    certid="$(echo "$bodyj" | jq -r '.certIdentifier // empty')"
    if [ -z "$cert" ] || [ -z "$key" ]; then
      # Do NOT echo the raw 2xx body — it carries .privateKey. Report which field
      # was empty instead.
      log "  ERROR: pki-bridge 2xx but empty field(s): cert_empty=$([ -z "$cert" ] && echo 1 || echo 0) key_empty=$([ -z "$key" ] && echo 1 || echo 0)"
      return 1
    fi
    log "  issued (id=${certid})"

    # 4a. persist to THIS container's volume. Note this is a per-app Coolify
    # volume, not a cluster-wide one — it is the freshness source for the next
    # cycle and the delivery path only for consumers that share this exact
    # volume. Cross-stack consumers are served by 4b (env), never by this.
    persist_issued_cert "$hostname" "$cert" "$key" || true
  fi

  # 4b. distribute to the consuming app's env (the cross-node path)
  if [ -z "$app_name" ]; then
    log "  no env-consumer mapping — delivered to shared volume only (no env consumer)"
    return 0
  fi
  if [ -z "${uuid:-}" ]; then
    log "  WARN: consumer '$app_name' unresolved — cannot distribute"
    return 1
  fi
  cert_b64="$(printf '%s' "$cert" | base64 | tr -d '\n')"
  key_b64="$(printf '%s' "$key" | base64 | tr -d '\n')"
  c1="$(patch_env "$uuid" "$cert_key" "$cert_b64")"
  c2="$(patch_env "$uuid" "$key_key" "$key_b64")"
  if [ "$c1" != "200" ] && [ "$c1" != "201" ]; then log "  ERROR: PATCH ${cert_key} -> HTTP ${c1}"; return 1; fi
  if [ "$c2" != "200" ] && [ "$c2" != "201" ]; then log "  ERROR: PATCH ${key_key} -> HTTP ${c2}"; return 1; fi
  log "  distributed to ${app_name} (${cert_key}/${key_key}); restarting to reload"
  rc="$(restart_app "$uuid")"
  log "  restart ${app_name} -> HTTP ${rc}"
  # A failed restart is NOT cosmetic, and treating it as such is self-sealing:
  # the consumer-freshness check at the top of this function reads the Coolify
  # env that THIS function just wrote. If the restart never happened, the next
  # cycle reads back our own write, logs "consumer cert valid beyond threshold —
  # skip", and the consumer keeps serving the OLD cert forever with every log
  # line green. "The env holds it" is not evidence "the process loaded it" — the
  # same class of defect as the volume/consumer confusion this function was fixed
  # for. Report the failure so the cycle stays unconverged and retries.
  case "$rc" in
    200|201|202|204)
      [ -n "$_rl" ] && rm -f "${_rl}/.reload-pending" 2>/dev/null
      ;;
    *)
      log "  ERROR: restart ${app_name} -> HTTP ${rc} — cert delivered but NOT loaded; will retry"
      # Durable, because the retry cannot rely on the env: gate 1 would read back
      # the value THIS cycle just wrote and call it converged.
      if [ -n "$_rl" ] && mkdir -p "$_rl" 2>/dev/null; then
        : > "${_rl}/.reload-pending" 2>/dev/null || true
      fi
      return 1
      ;;
  esac
  return 0
}

# Test seam: `PKI_RENEWER_LIB_ONLY=1 . pki-renewer.sh` loads the functions above
# and stops here, before any side effect (including the sha256sum below, which is
# not universally present). Lets a gate drive process_service() against stubbed
# collaborators and assert DELIVERY behaviour rather than grepping this file for
# a spelling. `return` is only valid in a sourced script; the fallback keeps a
# direct execution honest.
if [ "${PKI_RENEWER_LIB_ONLY:-0}" = "1" ]; then
  # Discriminate on $0, NOT on whether `return` fails. A previous revision assumed
  # a top-level `return` errors when the file is executed and so falls through:
  # that is true only in bash. MEASURED in alpine:3.20 (Dockerfile.pki-init's base,
  # i.e. busybox ash — the shell this actually runs in) and in dash and zsh, the
  # top-level `return` SUCCEEDS and terminates the script, producing zero output
  # and rc=0. A stray variable of this name in the pki stack's env would therefore
  # have stopped the renewer silently and green: /tmp/pki-renewer-alive never
  # touched, healthcheck red, the whole aisha-pki app unhealthy, cold-start wave 4
  # blocked — the exact failure the guard at the top of this file exists to prevent.
  case "$0" in
    */pki-renewer.sh|pki-renewer.sh)
      log "NOTE: PKI_RENEWER_LIB_ONLY is set but this script was EXECUTED, not sourced — ignoring it and running normally" ;;
    *)
      return 0 ;;
  esac
fi

secret_fp="$([ -n "$PKI_ISSUER_CLIENT_SECRET" ] && fp "$PKI_ISSUER_CLIENT_SECRET" || echo unset)"

log "PKI Renewer (unified issuer): interval=${RENEW_INTERVAL_HOURS}h threshold=${RENEW_THRESHOLD_DAYS}d bootstrap_poll=${BOOTSTRAP_POLL_SECONDS}s services=[${RENEW_SERVICES}] client=${PKI_ISSUER_CLIENT_ID} secret_fp=${secret_fp}"
# Touch the liveness file FIRST — the container is "healthy" (= the supervisor
# loop is running) even while it waits for bootstrap prerequisites. This is what
# keeps the aisha-pki app from being dragged unhealthy during cold-start.
touch /tmp/pki-renewer-alive

converged=0
# Backoff for the not-yet-converged path. A flat 60s retry kept re-enrolling for
# 14h straight while pki-bridge was down — and every failed cycle still queued
# revocations server-side. Double per failed cycle, capped at the steady cadence,
# so a stuck prerequisite decays to normal polling instead of hammering.
backoff="$BOOTSTRAP_POLL_SECONDS"
# --- vlastni svazkovy bundle: PKI stack si ho sam neobnovi ------------------
# Ostatnim konzumentum staci pri rotaci PRENASAZENI: jejich pki-init vola
# assemble-ca-bundle.sh, ktery stahne ZIVY bundle z pki-bridge. PKI stack to
# udelat NEMUZE -- pki-bridge -> pki-webui -> pki-client -> pki-server ->
# pki-init, takze cekat na bridge by byl deadlock, a jeho pki-init proto stage-uje
# ZMRAZENY config/pki/aisha-ca-bundle.pem (kореny z 2026-04-13).
#
# ⛔ NAMERENO 2026-08-22: kvuli tomu netbird-agent v PKI stacku prestal verit
# certifikatu mesh managementu (`x509: certificate signed by unknown authority`).
# PKI je TVRDA brana, takze jeho nezdravy agent zastavil 27 aplikaci vcetne
# databaze -- a navenek to vypadalo jako "interni chyba serveru" pri prihlaseni.
#
# Renewer tenhle svazek mountuje ZAPISOVATELNE a bezi az za zdravym bridgem,
# takze posledni krok obslouzi VOLUME, ne dalsi sitova cesta z agenta.
# Agent zmenu prevezme SAM: kazde `netbird up` je novy proces, ktery
# SSL_CERT_FILE cte znovu, a jeho smycka opakuje po 15 s. Zadny restart.
#
# Idempotentne KAZDY cyklus, ne jen pri detekci rotace: dnesni rozbity stav
# vznikl rotaci, ktera UZ probehla, takze hlidac rotace by nespustil nic.
# Nikdy nezapisujeme neoveritelny obsah -- pri jakemkoli nezdaru zustava,
# co tam je (nejhorsi pripad = dosavadni chovani).
# Konstanty, ne pojistky: obe cesty urcuje mount v compose, nikdo je nepretezuje.
LOCAL_BUNDLE=/certs/pki/aisha-ca-bundle.pem
SYSTEM_ROOTS=/etc/ssl/certs/ca-certificates.crt
sync_local_bundle() {
  [ -w "$(dirname "$LOCAL_BUNDLE")" ] || return 0
  _live="$(mktemp)" || return 0
  if ! curl -fsS --max-time 20 "${PKI_BRIDGE_URL%/}/diag/ca-bundle" -o "$_live" 2>/dev/null; then
    rm -f "$_live"; return 0
  fi
  if ! grep -q "BEGIN CERTIFICATE" "$_live"; then
    # 200 s prazdnym telem je dokumentovany stav "OpenXPKI jeste bootstrapuje".
    rm -f "$_live"; return 0
  fi
  _merged="$(mktemp)" || { rm -f "$_live"; return 0; }
  # SSL_CERT_FILE systemove koreny NAHRAZUJE, ne doplnuje -- bez nich by spotrebitel
  # prestal overovat verejne certifikaty (tyz zakon hlida brana pki-ca-bundle-system-merge).
  if [ -s "$SYSTEM_ROOTS" ]; then
    cat "$_live" "$SYSTEM_ROOTS" > "$_merged" 2>/dev/null || cp "$_live" "$_merged"
  else
    cp "$_live" "$_merged"
  fi
  if ! cmp -s "$_merged" "$LOCAL_BUNDLE" 2>/dev/null; then
    if mv "$_merged" "$LOCAL_BUNDLE" 2>/dev/null; then
      log "  local trust bundle obnoven z pki-bridge ($(grep -c 'BEGIN CERTIFICATE' "$LOCAL_BUNDLE") certifikatu) — agent ho prevezme do 15 s"
    fi
  fi
  rm -f "$_live" "$_merged" 2>/dev/null || true
}

while true; do
  all_ok=1

  # CA-ROOT ROTATION WATCH (once per cycle, before per-service issuance).
  # The realm CA is regenerated on --wipe / rotation. Consumers that built their
  # trust bundle once at pki-init then keep trusting the OLD root, and mesh TLS
  # collapses SILENTLY (leaf still date-valid, so the per-service checkend skip
  # would keep it). Detect a changed root fingerprint and heal: FORCE_REISSUE the
  # env-cert services (skip-bypass in process_service) + force-redeploy every
  # volume-bundle consumer so pki-init re-pulls the fresh bundle and the agent is
  # recreated. Rare-event gated (once per rotation) — no revocation storm.
  FORCE_REISSUE=0
  cur_root_fp="$(ca_root_fp)"
  sync_local_bundle
  if [ -n "$cur_root_fp" ]; then
    # $PKI_CERTS_DIR, not a hardcoded /certs/pki — the rest of the file is already
    # parameterised, and the literal made this block untestable and silently
    # volume-dependent.
    _fp_file="${PKI_CERTS_DIR}/.ca-root-fp"
    base_root_fp="$(cat "$_fp_file" 2>/dev/null || echo '')"
    if [ -z "$base_root_fp" ]; then
      # Report what actually happened. Swallowing the write with `|| true` and then
      # logging success meant that on an absent or read-only volume the baseline was
      # never stored, every cycle re-observed "first observation", and CA-root
      # ROTATION COULD NEVER BE DETECTED — with a reassuring log line each time.
      if mkdir -p "$PKI_CERTS_DIR" 2>/dev/null && printf '%s' "$cur_root_fp" > "$_fp_file" 2>/dev/null; then
        log "CA-root baseline recorded (fp=${cur_root_fp}) — no heal on first observation"
      else
        log "ERROR: cannot persist CA-root baseline to ${_fp_file} — rotation detection is DISABLED until this is fixed"
        all_ok=0
      fi
    elif [ "$cur_root_fp" != "$base_root_fp" ]; then
      log "CA-ROOT ROTATION detected (${base_root_fp} → ${cur_root_fp}) — healing consumers"
      FORCE_REISSUE=1
      # Táž úvaha jako v consumer_for(): bez identity by `<prefix>-<role>` ukázalo
      # na cizí instanci a heal by jí přenasadil aplikace. Reissue proběhne,
      # rozvoz se přeskočí — hlasitě, ne tiše.
      if [ -z "${APP_NAME_PREFIX:-}" ]; then
        log "  WARN: APP_NAME_PREFIX není nastaven — consumery se NEHOJÍ (neumím říct, ČÍ aplikace to jsou). Cert je vydaný, rozvoz čeká na deklarovanou identitu."
        BUNDLE_CONSUMER_ROLES=""
      fi
      # Prazdny seznam tu NENI "neni koho hojit" -- je to "nevim, koho hojit".
      # Driv tu stal rucni vycet 6 roli jako VYCHOZI hodnota a promennou nikdo
      # nenastavoval, takze ten vycet BYL tou hodnotou; chybel v nem i `pki` sam
      # a jeho agent po rotaci koorene nikdy nedostal nove kotvy (2026-08-22).
      # Hodnotu odvozuje cold-start (scripts/lib/derive-bundle-consumers.mjs).
      if [ -z "$BUNDLE_CONSUMER_ROLES" ] && [ -n "${APP_NAME_PREFIX:-}" ]; then
        log "  ERROR: BUNDLE_CONSUMER_ROLES je prazdne — po rotaci koorene CA by"
        log "         cast stacku zustala u starych kotev a jejich mesh agent by"
        log "         prestal verit vsemu. Odvozeni ma dorucit cold-start."
        return 1
      fi
      for role in $BUNDLE_CONSUMER_ROLES; do
        capp="${APP_NAME_PREFIX}-${role}"
        cuuid="$(app_uuid_by_name "$capp")"
        if [ -n "$cuuid" ]; then
          rc="$(redeploy_app "$cuuid")"
          log "  redeploy ${capp} (fresh CA bundle + recreate agent) → HTTP ${rc}"
        else
          log "  WARN: bundle-consumer '${capp}' not found in Coolify — skipped"
        fi
      done
      if ! printf '%s' "$cur_root_fp" > "$_fp_file" 2>/dev/null; then
        log "ERROR: healed for the rotation but could NOT update ${_fp_file} — the next cycle will heal again"
        all_ok=0
      fi
    fi
  fi

  for svc in $(echo "$RENEW_SERVICES" | tr ',' ' '); do
    [ -z "$svc" ] && continue
    process_service "$svc" || { all_ok=0; log "  WARN: ${svc} not renewed this cycle — will retry"; }
  done
  touch /tmp/pki-renewer-alive
  [ "$all_ok" = "1" ] && converged=1
  if [ "$converged" = "1" ]; then
    backoff="$BOOTSTRAP_POLL_SECONDS"
    log "all services current — next check in ${RENEW_INTERVAL_HOURS}h"
    sleep $(( RENEW_INTERVAL_HOURS * 3600 ))
  else
    log "prerequisites not ready — next check in ${backoff}s"
    sleep "$backoff"
    backoff=$(( backoff * 2 ))
    max_backoff=$(( RENEW_INTERVAL_HOURS * 3600 ))
    [ "$backoff" -gt "$max_backoff" ] && backoff="$max_backoff"
  fi
done
