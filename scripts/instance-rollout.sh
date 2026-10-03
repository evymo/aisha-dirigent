#!/usr/bin/env bash
# =============================================================================
# instance-rollout.sh — FINAL ROLLOUT: push the private instance-data repo's
# state to the LIVE stack (the day-2 operations entrypoint; idempotent)
# =============================================================================
# THE one script an operator runs from their host after changing anything in
# the PRIVATE aisha-instance-data repo (operator roster, Keycloak instance
# clients, instance SQL overlay). Nothing manual, nothing local-only: the
# private repo is the single source of truth and this script pushes its state
# against the live APIs. Re-running is always safe (every phase is idempotent).
#
# Phases (in order):
#   1. Overlay     clone AISHA_INSTANCE_DATA_GIT_URL (depth 1, optional "#ref"
#                  pin) — or use an existing checkout via --local=<path>.
#   2. KC clients  upsert every keycloak/*-client.json from the overlay into
#                  the app realm via the Keycloak Admin API (PUT when the
#                  clientId exists, POST otherwise) — same contract as
#                  keycloak/configure-realms.sh, scoped to instance clients.
#   3. Roster      scripts/db/provision-operators.mjs --create-only with
#                  AISHA_OPERATORS_FILE=<overlay>/operators.json: creates
#                  MISSING Keycloak users (their ONE-TIME temp passwords print
#                  below in [TEMP-PASSWORD] blocks; first login forces
#                  UPDATE_PASSWORD). Existing users are never modified.
#   4. DB plane    top-level *.sql + operator DB role grants. Applied directly
#                  ONLY when AISHA_DB_URL is set and psql is available;
#                  otherwise printed as a plan. On a deployed stack the DB
#                  plane applies inside the core `migrate` container on every
#                  core deploy (scripts/deploy/instance-data-hook.sh applies
#                  the SQL and exports the roster; the entrypoint then runs
#                  provision-operators --apply). Pass --redeploy-core to
#                  trigger exactly that via the Coolify API
#                  (scripts/aisha-redeploy.mjs --only=core). Default: off.
#
# Usage:
#   scripts/instance-rollout.sh                          # KC plane (clients + roster)
#   scripts/instance-rollout.sh --local=<path>           # use a local overlay checkout
#   scripts/instance-rollout.sh --redeploy-core          # + core re-migrate (DB plane)
#   AISHA_DB_URL=postgres://… scripts/instance-rollout.sh  # + direct SQL apply
#
# Env (NOTHING hardcoded — every value comes from env, falling back to the
# operator host's <repo>/.env.coolify written by cold-start):
#   AISHA_INSTANCE_DATA_GIT_URL   private overlay clone URL (unless --local)
#   KEYCLOAK_URL | KEYCLOAK_DOMAIN_PUBLIC | KEYCLOAK_DOMAIN   KC base
#   KEYCLOAK_ADMIN (default: admin), KEYCLOAK_ADMIN_PASSWORD  master admin-cli
#   KEYCLOAK_REALM (default: aisha)                           app realm
#   AISHA_DB_URL                  optional — enables direct DB-plane apply
#   COOLIFY_BASE_URL/COOLIFY_URL + COOLIFY_API_TOKEN          --redeploy-core
#                                 (resolved by aisha-redeploy.mjs itself)
#
# Secrets: the clone URL is redacted in every log line; admin passwords are
# never printed. The ONLY secret on stdout is the intentional one-time
# [TEMP-PASSWORD] block for newly created operators — copy it immediately,
# it is never persisted anywhere.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '[instance-rollout] %s\n' "$1"; }
warn() { printf '[instance-rollout] ⚠ %s\n' "$1" >&2; }
die()  { printf '[instance-rollout] ❌ %s\n' "$1" >&2; exit 1; }

command -v git  >/dev/null 2>&1 || die "git is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v node >/dev/null 2>&1 || die "node is required (see .nvmrc)"

# ── CLI ───────────────────────────────────────────────────────────────────────
LOCAL_OVERLAY=""
REDEPLOY_CORE=0
for arg in "$@"; do
  case "$arg" in
    --local=*) LOCAL_OVERLAY="${arg#--local=}" ;;
    --redeploy-core) REDEPLOY_CORE=1 ;;
    -h|--help)
      sed -n '2,56p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $arg (supported: --local=<path>, --redeploy-core, --help)" ;;
  esac
done

# ── Env resolution: process env first, then .env.coolify (never hardcoded) ───
ENV_FILE="${REPO_ROOT}/.env.coolify"
fill_from_env_file() {
  # fill_from_env_file VAR — when VAR is empty/unset and .env.coolify carries
  # it, export it (one pair of surrounding quotes stripped). Values stay
  # operator-side; this script ships zero deployment-specific defaults.
  key="$1"
  current="$(eval "printf '%s' \"\${${key}:-}\"")"
  if [ -n "$current" ] || [ ! -f "$ENV_FILE" ]; then return 0; fi
  line="$(grep -m1 -E "^${key}=" "$ENV_FILE" 2>/dev/null || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/")"
  [ -n "$value" ] || return 0
  export "${key}=${value}"
}
for k in AISHA_INSTANCE_DATA_GIT_URL KEYCLOAK_URL KEYCLOAK_DOMAIN_PUBLIC \
         KEYCLOAK_DOMAIN KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_REALM \
         COOLIFY_URL COOLIFY_BASE_URL COOLIFY_API_TOKEN APP_NAME_PREFIX; do
  fill_from_env_file "$k"
done

# ── Klíče federovaných providerů se ODVOZUJÍ, nevypisují ──────────────────────
#
# ⛔ NAMĚŘENO 2026-08-20: seznam výš je RUČNÍ, takže co v něm není, se
# z `.env.coolify` nenačte. Fáze providerů pak mlčky přeskočila všechny,
# přestože `ENABLE_GOOGLE_OAUTH=true` v souboru stálo. Táž díra jako ruční
# seznam šesti klíčů v `prepare-xcode-build.sh` (#211), který spolkl dveře
# i LiveKit: co seznam nejmenuje, nedoletí, a nic se neozve.
#
# Univerzum se proto bere z aliasů v PLATFORMNÍ šabloně realmu — nový provider
# tam dostane své klíče bez zásahu sem.
_idp_tpl="${REPO_ROOT}/keycloak/aisha-realm.json"
if [ -f "$_idp_tpl" ] && command -v node >/dev/null 2>&1; then
  for _a in $(node -e '
    const fs=require("fs");
    const t=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write((t.identityProviders||[]).map(p=>p.alias).join(" "));
  ' "$_idp_tpl" 2>/dev/null); do
    _u="$(printf '%s' "$_a" | tr '[:lower:]-' '[:upper:]_')"
    fill_from_env_file "ENABLE_${_u}_OAUTH"
    fill_from_env_file "OAUTH_${_u}_CLIENT_ID"
    fill_from_env_file "OAUTH_${_u}_CLIENT_SECRET"
    # U poskytovatele, jehož secret se RAZÍ (viz níž), potřebuje raznice další
    # klíče. NEVYPISUJEME je — zeptáme se jí. Ruční seznam by spolkl přesně to,
    # co v něm chybí, a mlčel by o tom.
    _minter="${REPO_ROOT}/keycloak/mint-${_a}-secret.py"
    if [ -f "$_minter" ]; then
      for _k in $(python3 "$_minter" --required-env 2>/dev/null); do
        fill_from_env_file "$_k"
      done
    fi
  done
fi

KC_URL="${KEYCLOAK_URL:-}"
if [ -z "$KC_URL" ] && [ -n "${KEYCLOAK_DOMAIN_PUBLIC:-}" ]; then KC_URL="https://${KEYCLOAK_DOMAIN_PUBLIC}"; fi
if [ -z "$KC_URL" ] && [ -n "${KEYCLOAK_DOMAIN:-}" ]; then KC_URL="https://${KEYCLOAK_DOMAIN}"; fi
[ -n "$KC_URL" ] || die "Keycloak base URL required — set KEYCLOAK_URL (or KEYCLOAK_DOMAIN_PUBLIC / KEYCLOAK_DOMAIN)"
KC_URL="${KC_URL%/}"
KC_REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"
KC_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KC_ADMIN_PW="${KEYCLOAK_ADMIN_PASSWORD:-}"
[ -n "$KC_ADMIN_PW" ] || die "KEYCLOAK_ADMIN_PASSWORD required (env or .env.coolify)"

# ── Phase 1/4: resolve the overlay (clone or --local) ────────────────────────
WORKDIR=""
cleanup() { if [ -n "$WORKDIR" ]; then rm -rf "$WORKDIR"; fi; }
trap cleanup EXIT

if [ -n "$LOCAL_OVERLAY" ]; then
  [ -d "$LOCAL_OVERLAY" ] || die "--local path not found: $LOCAL_OVERLAY"
  OVERLAY="$(cd "$LOCAL_OVERLAY" && pwd)"
  log "Phase 1/4: using LOCAL overlay checkout: $OVERLAY"
else
  URL_RAW="${AISHA_INSTANCE_DATA_GIT_URL:-}"
  [ -n "$URL_RAW" ] || die "AISHA_INSTANCE_DATA_GIT_URL not set (and no --local=<path>) — nothing to roll out"
  # Self-heal JSON-escaped slashes (`https:\/\/…` from a raw Coolify API dump;
  # PHP json_encode escapes `/` as `\/`) — same guard as instance-data-hook.sh.
  URL_RAW=$(printf '%s' "$URL_RAW" | sed 's|\\/|/|g')
  REF=""
  URL="$URL_RAW"
  case "$URL_RAW" in
    *"#"*) REF="${URL_RAW##*#}"; URL="${URL_RAW%#*}" ;;
  esac
  REDACTED=$(printf '%s' "$URL" | sed -E 's|(://)[^@/]+@|\1***@|')
  WORKDIR=$(mktemp -d /tmp/instance-rollout.XXXXXX)
  log "Phase 1/4: cloning instance overlay from ${REDACTED}${REF:+ (ref: $REF)} …"
  # ⛔ NAMĚŘENO 2026-08-20 na riqi: klon padal na `RPC failed; curl 18
  # Transferred a partial file` — velký pack (overlay má 84 MB) se přes jedno
  # spojení utrhl. Byly to DVĚ vady nad sebou:
  #
  #   1. `2>/dev/null` zahodilo jedinou větu, která říkala CO se stalo. Zbylo
  #      „clone failed", což vypadá jako špatné pověření — přitom `ls-remote`
  #      proti témuž URL vracel refy. Diagnostika se proto SCHOVÁVÁ, ne zahazuje,
  #      a při konečném nezdaru se VYSLOVÍ (s redakcí pověření).
  #   2. Jediný pokus. Přenos se ale utrhne nahodile, takže se to zkouší třikrát
  #      a od druhého pokusu ČÁSTEČNÝM klonem — `--filter=blob:none` rozloží
  #      jeden velký pack na víc menších požadavků a projde tam, kde celý ne.
  #
  # Fallback to není: cíl (mít overlay) je pořád týž, mění se jen cesta k němu.
  # Kdyby neprošel ani třetí pokus, končí se PÁDEM — ne tichým pokračováním.
  KLON_ERR="$(mktemp)"
  KLON_OK=""
  for POKUS in 1 2 3; do
    rm -rf "$WORKDIR/repo"
    if [ "$POKUS" -ge 2 ]; then FILTR="--filter=blob:none"; else FILTR=""; fi
    # shellcheck disable=SC2086 # $FILTR je záměrně nerozdělený prázdný přepínač
    if [ -n "$REF" ]; then
      git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999 \
        clone --quiet --depth 1 $FILTR --branch "$REF" "$URL" "$WORKDIR/repo" 2>"$KLON_ERR" && KLON_OK=1
    else
      git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999 \
        clone --quiet --depth 1 $FILTR "$URL" "$WORKDIR/repo" 2>"$KLON_ERR" && KLON_OK=1
    fi
    if [ -n "$KLON_OK" ]; then
      [ "$POKUS" -gt 1 ] && log "  overlay naklonován až na ${POKUS}. pokus (částečný klon)"
      break
    fi
    log "  ⚠ klon overlay selhal (${POKUS}/3): $(sed -E 's|(://)[^@/]+@|\1***@|' "$KLON_ERR" | tr '\n' ' ' | tail -c 200)"
  done
  if [ -z "$KLON_OK" ]; then
    DUVOD="$(sed -E 's|(://)[^@/]+@|\1***@|' "$KLON_ERR" | tr '\n' ' ')"
    rm -f "$KLON_ERR"
    die "clone of ${REDACTED}${REF:+ @ $REF} failed po 3 pokusech: ${DUVOD}"
  fi
  rm -f "$KLON_ERR"
  OVERLAY="$WORKDIR/repo"
fi

# ── Phase 2/4: Keycloak instance clients (idempotent upsert) ─────────────────
kc_token() {
  curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    --data-urlencode "client_id=admin-cli" \
    --data-urlencode "username=${KC_ADMIN}" \
    --data-urlencode "password=${KC_ADMIN_PW}" \
    --data-urlencode "grant_type=password" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).access_token||"")}catch{/* empty */}})'
}

log "Phase 2/4: Keycloak instance clients (realm: ${KC_REALM}, base: ${KC_URL})"
IC_COUNT=0
for f in "$OVERLAY"/keycloak/*-client.json; do
  [ -e "$f" ] || continue
  CID="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).clientId||""))' "$f" 2>/dev/null)" \
    || die "$(basename "$f"): unreadable"
  [ -n "$CID" ] || die "$(basename "$f"): not valid JSON with a clientId"
  # KC ClientRepresentation rejects unknown fields (HTTP 400) — strip doc-only
  # keys so instance-client seeds smějí nést dokumentaci uvnitř dat.
  #
  # ⛔ NAMĚŘENO 2026-09-05: strhávalo se jen `_`, jenže overlay používá `$`
  # (`$note` v 01-<fork>-client.json, `$note`/`$todo` v operators.json, kde je
  # provision-operators bez potíží ignoruje). Dvě strany téhož zvyku se tedy
  # neshodly a Keycloak vracel:
  #   Unrecognized field "$note" (class ClientRepresentation), not marked as ignorable
  # Fáze 2 na tom umřela a rollout se NIKDY nedostal k fázi 2c (federovaní
  # poskytovatelé) — Google se proto nedal zapnout touhle cestou vůbec.
  # Strhávají se OBA prefixy: `$` je zavedený tvar, `_` zůstává kvůli starším
  # souborům.
  CLEAN="$(mktemp)"
  node -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));for(const k of Object.keys(d))if(k.startsWith("_")||k.startsWith("$"))delete d[k];fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$f" "$CLEAN" \
    || { rm -f "$CLEAN"; die "$(basename "$f"): strip failed"; }
  # Master-realm admin tokens default to a 60 s lifetime — mint per client so
  # a slow clone or a long client list never hits an expired token.
  TOKEN="$(kc_token)"
  [ -n "$TOKEN" ] || die "Keycloak admin auth failed (check KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD against ${KC_URL})"
  CUUID="$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
      "${KC_URL}/admin/realms/${KC_REALM}/clients?clientId=${CID}" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);process.stdout.write(a&&a[0]?a[0].id:"")}catch{/* empty */}})')" \
    || CUUID=""
  if [ -n "$CUUID" ]; then
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
      "${KC_URL}/admin/realms/${KC_REALM}/clients/${CUUID}" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      --data-binary @"$CLEAN" 2>/dev/null || true)
  else
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      "${KC_URL}/admin/realms/${KC_REALM}/clients" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      --data-binary @"$CLEAN" 2>/dev/null || true)
  fi
  rm -f "$CLEAN"
  case "$HTTP" in
    2*) log "  ✅ instance client '${CID}' upserted ($(basename "$f") → HTTP ${HTTP})"; IC_COUNT=$((IC_COUNT + 1)) ;;
    *)  die "instance client '${CID}': HTTP ${HTTP}" ;;
  esac

  # ── Client scopes: the representation does NOT carry them ──────────────────
  # Keycloak IGNORES `defaultClientScopes`/`optionalClientScopes` inside the
  # client representation on both POST and PUT; they are only settable through
  # the sub-resource `/clients/{uuid}/{default|optional}-client-scopes/{scopeId}`.
  # Without this, the upsert above reports success while the live client keeps
  # `defaultClientScopes: []` — and every sign-in dies on
  # `invalid_scope: Invalid scopes: openid profile email`. Measured on production
  # 2026-08-03: that is exactly what an instance mobile app hit, for days, while this
  # script claimed the client was in sync. keycloak/configure-realms.sh grew the
  # same block on 2026-08-02; this is the day-2 entrypoint, so it needs it too —
  # otherwise "the one script an operator runs" quietly under-delivers.
  #
  # Additive on purpose: the seed says what MUST be there, not what may be there
  # on its own, so scopes the file does not mention are left alone. Idempotent PUT.
  CUUID="$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
      "${KC_URL}/admin/realms/${KC_REALM}/clients?clientId=${CID}" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);process.stdout.write(a&&a[0]?a[0].id:"")}catch{/* empty */}})')" \
    || CUUID=""
  if [ -n "$CUUID" ]; then
    SCOPES_JSON="$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
      "${KC_URL}/admin/realms/${KC_REALM}/client-scopes" 2>/dev/null)" || SCOPES_JSON="[]"
    for KIND in default optional; do
      WANTED="$(KIND="$KIND" node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((d[process.env.KIND+"ClientScopes"]||[]).join("\n"))' "$f" 2>/dev/null)" || WANTED=""
      [ -n "$WANTED" ] || continue
      while IFS= read -r SCOPE; do
        [ -n "$SCOPE" ] || continue
        SID="$(printf '%s' "$SCOPES_JSON" | SCOPE="$SCOPE" node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);const s=a.find(x=>x.name===process.env.SCOPE);process.stdout.write(s?s.id:"")}catch{/* empty */}})')" || SID=""
        if [ -z "$SID" ]; then
          log "  ⚠️ instance client '${CID}': ${KIND} scope '${SCOPE}' does not exist in the realm — the seed promises what the realm does not have"
          continue
        fi
        SC_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
          "${KC_URL}/admin/realms/${KC_REALM}/clients/${CUUID}/${KIND}-client-scopes/${SID}" \
          -H "Authorization: Bearer ${TOKEN}" 2>/dev/null || true)
        case "$SC_HTTP" in
          2*) log "     ${KIND} scope '${SCOPE}' → ${CID}" ;;
          *)  log "  ⚠️ instance client '${CID}': ${KIND} scope '${SCOPE}' → HTTP ${SC_HTTP}" ;;
        esac
      done <<EOF_SCOPES
$WANTED
EOF_SCOPES
    done
  fi
done
if [ "$IC_COUNT" -eq 0 ]; then
  log "  no keycloak/*-client.json in the overlay — nothing to upsert"
fi

# ── Phase 2b: realm settings from the overlay (session policy) ───────────────
# How long a session may live is a SECURITY parameter of the instance, not of
# the platform — but it had no channel: configure-realms.sh does not read realm
# settings from data, and the realm template in the fork is platform-wide (and
# only lands on --import-realm into an EMPTY realm, i.e. after a wipe). Setting
# it by hand in the console would be a value the next wipe throws away.
#
# So the overlay may carry `keycloak/00-realm-sessions.json` with a
# `realm_settings` object. It is MERGED into the live RealmRepresentation:
# GET → overlay keys win → PUT. Keys the file does not mention are left alone,
# so this never silently resets something the console owns. Underscore keys are
# documentation and are stripped, same convention as the client files.
REALM_FILE="$OVERLAY/keycloak/00-realm-sessions.json"
if [ -f "$REALM_FILE" ]; then
  log "Phase 2b/4: realm settings (session policy) from the overlay"
  TOKEN="$(kc_token)"
  [ -n "$TOKEN" ] || die "Keycloak admin auth failed before realm settings"
  CURRENT="$(mktemp)"
  curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "${KC_URL}/admin/realms/${KC_REALM}" -o "$CURRENT" \
    || die "could not read realm '${KC_REALM}'"
  MERGED="$(mktemp)"
  CHANGES="$(node -e '
    const fs=require("fs");
    const cur=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const raw=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).realm_settings||{};
    // Doku-klíče se strhávají OBĚMA zvyky — viz fáze 2: overlay píše `$note`,
    // starší soubory `_note`. Filtr jen na jeden z nich je táž vada dvakrát.
    const want=Object.fromEntries(Object.entries(raw).filter(([k])=>!k.startsWith("_")&&!k.startsWith("$")));
    const diff=[];
    for(const [k,v] of Object.entries(want)){
      if(JSON.stringify(cur[k])!==JSON.stringify(v)){diff.push(`${k}: ${JSON.stringify(cur[k])} → ${JSON.stringify(v)}`);}
      cur[k]=v;
    }
    fs.writeFileSync(process.argv[3], JSON.stringify(cur));
    process.stdout.write(diff.join("\n"));
  ' "$CURRENT" "$REALM_FILE" "$MERGED")" || { rm -f "$CURRENT" "$MERGED"; die "realm settings merge failed"; }
  if [ -z "$CHANGES" ]; then
    log "  realm already matches the overlay — nothing to change"
  else
    printf '%s\n' "$CHANGES" | while IFS= read -r line; do log "  $line"; done
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
      "${KC_URL}/admin/realms/${KC_REALM}" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      --data-binary @"$MERGED" 2>/dev/null || true)
    case "$HTTP" in
      2*) log "  ✅ realm settings applied (HTTP ${HTTP})" ;;
      *)  rm -f "$CURRENT" "$MERGED"; die "realm settings: HTTP ${HTTP}" ;;
    esac
  fi
  rm -f "$CURRENT" "$MERGED"
fi

# ── Phase 2c/4: federated identity providers (Google / Apple) ────────────────
#
# ⛔ NAMĚŘENO 2026-08-20: `ENABLE_GOOGLE_OAUTH=true` i `ENABLE_APPLE_OAUTH=true`
# byly v SoT ZAPNUTÉ, `docs/deploy/OAUTH_PROVIDERS.md` popisuje celé nastavení
# a šablona realmu ty providery deklaruje — a přihlašovací stránka nabízela
# JEN heslo. Příčina: ty vlajky NIKDO V KÓDU NEČETL (jediné výskyty byly
# v dokumentaci a v `.env.coolify.example`). Zapnutá vlajka bez konzumenta je
# horší než chybějící: tvrdí, že něco funguje.
#
# ⭐ PODOBA SE ODVOZUJE, NEPÍŠE. Definice providerů (providerId, defaultScope,
# syncMode, useJwksUrl, guiOrder) se berou z PLATFORMNÍ šablony realmu — tam už
# stojí, včetně `${OAUTH_*}` zástupných symbolů. Instance dodává jen POVĚŘENÍ
# přes prostředí. Nic instančního se tím do repa nepíše a každý fork dostane
# totéž chování bez zásahu.
#
# Šablona sama se aplikuje jen při `--import-realm` do PRÁZDNÉHO realmu, takže
# na běžící instanci se k ní nikdo nedostane — proto tahle fáze.
#
# Redirect URI se NEKONFIGURUJE: Keycloak ho odvozuje z realmu jako
#   <KC_URL>/realms/<realm>/broker/<alias>/endpoint
# Vypisuje se proto níž — je to hodnota, kterou operátor vkládá u Googlu/Applu.
REALM_TEMPLATE="$REPO_ROOT/keycloak/aisha-realm.json"
if [ -f "$REALM_TEMPLATE" ]; then
  log "Phase 2c/4: federated identity providers (podoba ze šablony, pověření z prostředí)"
  TOKEN="$(kc_token)"
  [ -n "$TOKEN" ] || die "Keycloak admin auth failed before identity providers"

  # Univerzum se HLEDÁ v šabloně, nevypisuje — nový provider v šabloně se sem
  # dostane bez zásahu do tohohle skriptu.
  ALIASES="$(node -e '
    const fs=require("fs");
    const t=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write((t.identityProviders||[]).map(p=>p.alias).join(" "));
  ' "$REALM_TEMPLATE")"

  for ALIAS in $ALIASES; do
    UP="$(printf '%s' "$ALIAS" | tr '[:lower:]-' '[:upper:]_')"
    ENABLED="$(eval "printf '%s' \"\${ENABLE_${UP}_OAUTH:-}\"")"
    CID="$(eval "printf '%s' \"\${OAUTH_${UP}_CLIENT_ID:-}\"")"
    CSEC="$(eval "printf '%s' \"\${OAUTH_${UP}_CLIENT_SECRET:-}\"")"

    # ⭐ ROZHODUJÍ POVĚŘENÍ, NE VLAJKA. Federované přihlášení je VOLITELNÉ:
    # kdo pověření má, toho provider naskočí; kdo je nemá, ten prostě Google
    # ani Apple na přihlašovací stránce nemá. Tvrdý pád by kvůli nepovinné
    # věci zablokoval celý rollout — a to je horší než nemít Google.
    #
    # ⛔ ALE NIKDY TIŠE. Právě tichý přeskok tuhle vadu osm měsíců držel:
    # `ENABLE_GOOGLE_OAUTH=true` svítilo, providery byly v šabloně, dokument
    # existoval — a přihlašovací stránka nabízela jen heslo. Chybějící pověření
    # se proto VYSLOVÍ, včetně redirect URI, který je u poskytovatele potřeba.
    case "$ENABLED" in
      false|FALSE|0|no)
        log "  ${ALIAS}: vypnuto výslovně (ENABLE_${UP}_OAUTH=${ENABLED}) — nesahám na to"
        continue ;;
    esac

    # ⭐ SECRET SE U NĚKTERÝCH POSKYTOVATELŮ NEDEKLARUJE, ALE RAZÍ.
    # Apple stropuje client secret na ES256 JWT s platností 6 měsíců — statická
    # hodnota tedy vždycky jednou vyprší a přihlášení TIŠE umře. Univerzum se
    # i tady HLEDÁ: je-li vedle šablony `mint-<alias>-secret.py`, má přednost
    # před statickou hodnotou. Tutéž raznici volá configure-realms.sh při startu,
    # takže obě cesty vyrábějí bit po bitu totéž.
    MINTER="${REPO_ROOT}/keycloak/mint-${ALIAS}-secret.py"
    if [ -f "$MINTER" ]; then
      MERR="$(mktemp)"
      MINTED="$(python3 "$MINTER" 2>"$MERR" || true)"
      if [ -n "$MINTED" ]; then
        CSEC="$MINTED"
        log "  ${ALIAS}: client secret se NEDEKLARUJE, razí se (mint-${ALIAS}-secret.py, platnost ~6 měsíců)"
      else
        # Nezdar se vysloví i s důvodem — jinak by z toho byl tichý přeskok.
        log "  ⚠ ${ALIAS}: ražba secretu selhala: $(tr '\n' ' ' < "$MERR")"
      fi
      rm -f "$MERR"
    fi

    if [ -z "$CID" ] || [ -z "$CSEC" ]; then
      log "  ⚠ ${ALIAS}: NENÍ nastaven — chybí OAUTH_${UP}_CLIENT_ID / OAUTH_${UP}_CLIENT_SECRET."
      log "     Přihlašovací stránka proto ${ALIAS} nenabídne (heslo funguje dál)."
      log "     Až budeš mít pověření, zaregistruj u poskytovatele tenhle redirect URI:"
      log "       ${KC_URL}/realms/${KC_REALM}/broker/${ALIAS}/endpoint"
      continue
    fi

    IDP_JSON="$(mktemp)"
    node -e '
      const fs=require("fs");
      const [tpl,alias,cid,csec,out]=process.argv.slice(1);
      const t=JSON.parse(fs.readFileSync(tpl,"utf8"));
      const p=(t.identityProviders||[]).find(x=>x.alias===alias);
      if(!p){process.stderr.write("alias not in template");process.exit(1);}
      const cfg=Object.assign({},p.config,{clientId:cid,clientSecret:csec});
      fs.writeFileSync(out,JSON.stringify(Object.assign({},p,{enabled:true,config:cfg})));
    ' "$REALM_TEMPLATE" "$ALIAS" "$CID" "$CSEC" "$IDP_JSON"       || { rm -f "$IDP_JSON"; die "${ALIAS}: could not render identity provider from the template"; }

    EXISTS=$(curl -s -o /dev/null -w "%{http_code}"       -H "Authorization: Bearer ${TOKEN}"       "${KC_URL}/admin/realms/${KC_REALM}/identity-provider/instances/${ALIAS}" 2>/dev/null || true)
    if [ "$EXISTS" = "200" ]; then
      HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT         "${KC_URL}/admin/realms/${KC_REALM}/identity-provider/instances/${ALIAS}"         -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json"         --data-binary @"$IDP_JSON" 2>/dev/null || true)
    else
      HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST         "${KC_URL}/admin/realms/${KC_REALM}/identity-provider/instances"         -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json"         --data-binary @"$IDP_JSON" 2>/dev/null || true)
    fi
    rm -f "$IDP_JSON"
    case "$HTTP" in
      2*) log "  ✅ ${ALIAS} zapnut (HTTP ${HTTP}) — redirect URI: ${KC_URL}/realms/${KC_REALM}/broker/${ALIAS}/endpoint" ;;
      *)  die "${ALIAS}: identity provider upsert selhal (HTTP ${HTTP})" ;;
    esac
  done
else
  log "Phase 2c/4: šablona realmu není v repu — identity providery přeskočeny"
fi

# ── Phase 2d/4: srovnání OIDC secretů konzumentů ke Keycloaku ────────────────
#
# ⛔ NAMĚŘENO 2026-08-20 na riqi: přihlášení do extranetu končilo hláškou
#   `token exchange failed: "unauthorized_client" "Invalid client credentials"`.
# Přihlášení SAMO proběhlo — Keycloak vydal kód — ale oauth2-proxy ho nesměnil,
# protože držel JINÝ client secret než Keycloak (43 vs 32 znaků).
#
# A nebyl to jeden klient: rozešlo se 11 kopií napříč 7 aplikacemi (appsmith,
# nocodb, langfuse, studio, n8n, openclaw, extranet). Tedy ne náhoda, ale
# CHYBĚJÍCÍ SMYČKA — nástroj na to v repu byl, jen ho nikdo nevolal.
#
# ⛔ AUTORITA PŘEHODNOCENA 2026-08-24 (rozhodl majitel). Do té doby tu stálo
# „autorita je Keycloak, konzumenti se srovnávají k němu". Ten směr je ale
# neproveditelný a 2026-08-24 se stejná vada vrátila i s touhle fází zapojenou:
#   • kontejner si z KC číst NEUMÍ (hodnotu bere z Coolify env přes compose),
#   • redeploy si před nasazením sype env z `.env.coolify` a vyléčenou kopii
#     PŘEPÍŠE (naměřeno: oprava zmizela do několika sekund),
#   • po `--wipe` KC žádnou hodnotu nemá — vzniká v generate-secrets.
# AUTORITA JE `.env.coolify`. Tahle fáze proto rozdíl DETEKUJE a spustí
# vlastníky oprav (provision-sso.sh do KC, coolify-sync-envs.sh do Coolify).
#
# Mobilní appka tímhle netrpí: je to VEŘEJNÝ klient, nemá secret, není co
# rozejít. Rozchází se právě jen důvěrní klienti za proxy — a to je ta část,
# která musí jet sama, ne rukou.
_recon="${REPO_ROOT}/scripts/reconcile-oidc-secrets.mjs"
if [ -f "$_recon" ] && [ -n "${COOLIFY_API_TOKEN:-}" ]; then
  log "Phase 2d/4: OIDC secrety konzumentů (autorita = .env.coolify)"
  RECON_OUT="$(mktemp)"
  if KEYCLOAK_URL="$KC_URL" KEYCLOAK_REALM="$KC_REALM" \
     KEYCLOAK_ADMIN="$KC_ADMIN" KEYCLOAK_ADMIN_PASSWORD="$KC_ADMIN_PW" \
     node "$_recon" --apply >"$RECON_OUT" 2>&1; then
    sed -n 's/^/  /p' "$RECON_OUT" | grep -E "FIX|OK|Healed|drift" || true
  else
    # Nepovinná fáze: rozešlý secret NEBLOKUJE rollout, ale VYSLOVÍ se.
    log "  ⚠ srovnání OIDC secretů selhalo: $(tail -3 "$RECON_OUT" | tr '\n' ' ')"
  fi
  rm -f "$RECON_OUT"
else
  log "Phase 2d/4: přeskočeno (chybí reconcile-oidc-secrets.mjs nebo COOLIFY_API_TOKEN)"
fi

# ── Phase 3/4: operator roster (create missing KC users; idempotent) ─────────
log "Phase 3/4: operator roster (provision-operators --create-only)"
ROSTER="$OVERLAY/operators.json"
if [ -f "$ROSTER" ]; then
  # AISHA_OPERATORS is force-emptied so the INSTANCE roster deterministically
  # wins (roster priority since 2026-08-07: AISHA_OPERATORS_FILE >
  # AISHA_OPERATORS env > config/operators.json > AISHA_PRIMARY_ADMIN_EMAIL >
  # realm fallback). The file now outranks the env on its own, so this is
  # belt-and-braces — kept because it also silences the ROSTER CONFLICT report
  # for a stale snapshot this script has no business reconciling.
  ( cd "$REPO_ROOT" && \
    AISHA_OPERATORS="" \
    AISHA_OPERATORS_FILE="$ROSTER" \
    KEYCLOAK_URL="$KC_URL" \
    KEYCLOAK_REALM="$KC_REALM" \
    KEYCLOAK_ADMIN="$KC_ADMIN" \
    KEYCLOAK_ADMIN_PASSWORD="$KC_ADMIN_PW" \
    node scripts/db/provision-operators.mjs --create-only </dev/null ) \
    || die "operator roster ensure failed"
  log "  roster ensured in Keycloak (copy any [TEMP-PASSWORD] block above NOW — shown once)"
else
  warn "no top-level operators.json in the overlay — roster phase skipped"
  warn "add operators.json ({\"operators\":[…]}, shape of config/operators.json.example) to the private instance-data repo"
fi

# ── Phase 4/4: DB plane (instance SQL + operator DB role grants) ─────────────
log "Phase 4/4: DB plane"
SQL_COUNT=0
for f in "$OVERLAY"/*.sql; do
  [ -e "$f" ] || continue
  SQL_COUNT=$((SQL_COUNT + 1))
  log "  would apply: $(basename "$f")"
done
log "  would apply: operator DB role grants (provision-operators --apply)"

if [ -n "${AISHA_DB_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  log "  AISHA_DB_URL set + psql available → applying directly (idempotent)"
  for f in "$OVERLAY"/*.sql; do
    [ -e "$f" ] || continue
    log "  applying $(basename "$f") …"
    psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  if [ -f "$ROSTER" ]; then
    ( cd "$REPO_ROOT" && \
      AISHA_OPERATORS="" \
      AISHA_OPERATORS_FILE="$ROSTER" \
      AISHA_DB_URL="$AISHA_DB_URL" \
      KEYCLOAK_URL="$KC_URL" \
      KEYCLOAK_REALM="$KC_REALM" \
      KEYCLOAK_ADMIN="$KC_ADMIN" \
      KEYCLOAK_ADMIN_PASSWORD="$KC_ADMIN_PW" \
      node scripts/db/provision-operators.mjs --apply </dev/null ) \
      || die "operator DB role grants failed"
  else
    warn "no overlay operators.json — operator DB role grants skipped"
  fi
  log "  ✅ DB plane applied directly ($SQL_COUNT SQL file(s))"
else
  log "  AISHA_DB_URL not set (or psql unavailable) — DB plane NOT applied from this host."
  log "  On a deployed stack the DB plane applies inside the core 'migrate' container:"
  log "    - scripts/deploy/instance-data-hook.sh applies the overlay's top-level *.sql"
  log "    - the entrypoint then runs provision-operators --apply (roster auto-exported from the overlay)"
  if [ "$REDEPLOY_CORE" -eq 0 ]; then
    log "  re-run with --redeploy-core to trigger it now (Coolify API), or redeploy aisha-core any other way"
  fi
fi

# ── Optional: trigger the in-stack DB plane via the Coolify API ──────────────
# Default OFF: a core redeploy is a production action; the flag makes it an
# explicit decision. The migrate container re-run is fully idempotent.
if [ "$REDEPLOY_CORE" -eq 1 ]; then
  log "--redeploy-core: triggering the idempotent core re-migrate via the Coolify API …"
  ( cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs --only=core </dev/null ) \
    || die "core redeploy failed (check COOLIFY_BASE_URL/COOLIFY_URL + COOLIFY_API_TOKEN)"
  log "✅ core redeploy triggered — the migrate container re-applies the DB plane"
fi

log "✅ FINAL ROLLOUT complete — instance-data state pushed (idempotent; re-run any time)."
