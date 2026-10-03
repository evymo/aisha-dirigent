#!/usr/bin/env bash
# provision-surfaces.sh — create + deploy the instance's single-purpose surface
# SPAs (extranet, mobile, …) and their Keycloak public clients.
#
# A "surface" is the generic surface-host image (deploy/surface-host/Dockerfile in
# the surfaces repo) built with SHELL_APP=<shell> + INSTANCE_DIR=instances/<slug>
# and served static on :8080. It is a standalone Coolify Dockerfile app (a
# different repo than the compose stacks), so story-init's role:server:compose
# model doesn't fit — this is its dedicated provisioner, in the same spirit as
# provision-intranet.sh / provision-appsmith.sh.
#
# OPT-IN: does nothing unless AISHA_SURFACES is set, so instances with no surfaces
# (and the upstream aisha stack) are unaffected.
#
# Declaration — AISHA_SURFACES is a CSV of  surface:shell:subdomain  triples:
#     AISHA_SURFACES="extranet:workbench-shell:extra"
# yields Coolify app + KC client  <APP_NAME_PREFIX>-extranet  on
# extra.<PUBLIC_TLD>, built from apps/workbench-shell against instances/<slug>.
#
# Idempotent: an app / client that already exists is reconciled, not duplicated.
#
# Required env (all present in cold-start's environment):
#   COOLIFY_BASE_URL, COOLIFY_API_TOKEN, COOLIFY_PROJECT_UUID
#   AISHA_SURFACE_REPO   git clone URL of the repo Coolify builds the surface
#                        from (token-in-URL). This is THIS repo — the shells
#                        (apps/*-shell) and deploy/surface-host/Dockerfile live
#                        here since the staging repo was dissolved. Falls back to
#                        the checkout's own `origin` remote, so the common case
#                        needs no configuration at all.
#   AISHA_SURFACE_BRANCH branch Coolify tracks (default: main). Pinning a feature
#                        branch means merges to main never reach the surface —
#                        measured 2026-07-27, the live extranet tracked a feature
#                        branch long after its work had merged.
#   AISHA_INSTANCE_SLUG  instances/<slug> overlay to build against (default: APP_NAME_PREFIX)
#   APP_NAME_PREFIX, PUBLIC_TLD
#   KEYCLOAK_URL, KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_REALM (default: aisha)
set -euo pipefail

log()  { printf '[provision-surfaces] %s\n' "$*"; }
warn() { printf '[provision-surfaces] ⚠️  %s\n' "$*" >&2; }
die()  { printf '[provision-surfaces] FATAL: %s\n' "$*" >&2; exit 1; }

SURFACES="${AISHA_SURFACES:-}"
if [ -z "$SURFACES" ]; then
  log "AISHA_SURFACES unset — no surfaces to provision (skip)."
  exit 0
fi

need() { [ -n "${!1:-}" ] || die "$1 is required when AISHA_SURFACES is set"; }

# Surfaces are built from THIS repo (apps/*-shell + deploy/surface-host/Dockerfile
# landed here when the aisha-multi-surface staging repo was dissolved). So the
# sensible default is the checkout's own origin — an operator redeploying a
# surface should not have to restate where the code lives. An explicit
# AISHA_SURFACE_REPO still wins, which is what a token-in-URL clone needs.
if [ -z "${AISHA_SURFACE_REPO:-}" ]; then
  AISHA_SURFACE_REPO="$(git -C "$(dirname "$0")/.." remote get-url origin 2>/dev/null || true)"
  [ -n "$AISHA_SURFACE_REPO" ] && log "AISHA_SURFACE_REPO unset — using this checkout's origin: ${AISHA_SURFACE_REPO%%:*}…"
fi
export AISHA_SURFACE_REPO

for v in COOLIFY_BASE_URL COOLIFY_API_TOKEN COOLIFY_PROJECT_UUID AISHA_SURFACE_REPO APP_NAME_PREFIX PUBLIC_TLD KEYCLOAK_URL KEYCLOAK_ADMIN_PASSWORD; do need "$v"; done

CB="${COOLIFY_BASE_URL%/}"
BRANCH="${AISHA_SURFACE_BRANCH:-main}"
SLUG="${AISHA_INSTANCE_SLUG:-$APP_NAME_PREFIX}"
REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"
KC="${KEYCLOAK_URL%/}"

cf()  { curl -sS -m 60 -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Content-Type: application/json" "$@"; }

# ── Resolve server + destination from an existing app in this project ─────────
# Every compose stack in the project already lives on the target server; borrow
# its server/destination rather than hard-coding infra UUIDs.
log "Resolving server + destination from project $COOLIFY_PROJECT_UUID …"
APPS_JSON="$(cf "$CB/api/v1/applications")" || die "cannot list applications"
read -r SERVER_UUID DEST_UUID ENV_NAME < <(printf '%s' "$APPS_JSON" | APP_PREFIX="$APP_NAME_PREFIX" PROJ="$COOLIFY_PROJECT_UUID" python3 -c '
import sys, json, os
apps = json.load(sys.stdin)
pref = os.environ["APP_PREFIX"]
for a in apps:
    if not isinstance(a, dict): continue
    if (a.get("name") or "").startswith(pref + "-"):
        d = a.get("destination") or {}
        srv = (d.get("server") or {}).get("uuid") if isinstance(d.get("server"), dict) else None
        print(srv or "", d.get("uuid") or "", a.get("environment_name") or "production")
        break
') || true
[ -n "${DEST_UUID:-}" ] || die "no existing ${APP_NAME_PREFIX}-* app found to derive server/destination"
ENV_NAME="${ENV_NAME:-production}"
log "  server=$SERVER_UUID destination=$DEST_UUID environment=$ENV_NAME"

# ── Keycloak admin token ──────────────────────────────────────────────────────
kc_token() {
  curl -sf -m 20 -X POST "$KC/realms/master/protocol/openid-connect/token" \
    -d client_id=admin-cli -d username="${KEYCLOAK_ADMIN:-admin}" \
    --data-urlencode "password=$KEYCLOAK_ADMIN_PASSWORD" -d grant_type=password \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'
}
KTOK="$(kc_token)" || die "keycloak admin login failed"

# ── Per-surface provisioning ──────────────────────────────────────────────────
IFS=',' read -ra ENTRIES <<< "$SURFACES"
for entry in "${ENTRIES[@]}"; do
  IFS=':' read -r surface shell sub <<< "$entry"
  [ -n "$surface" ] && [ -n "$shell" ] && [ -n "$sub" ] || { warn "bad surface spec '$entry' (want surface:shell:subdomain) — skip"; continue; }
  app="${APP_NAME_PREFIX}-${surface}"
  fqdn="https://${sub}.${PUBLIC_TLD}"
  log "── ${app}  →  ${fqdn}  (shell=${shell}, instance=${SLUG}) ──"

  # 1) Coolify surface-host app (create if absent) ----------------------------
  existing="$(printf '%s' "$APPS_JSON" | NAME="$app" python3 -c 'import sys,json,os;print(next((a.get("uuid") for a in json.load(sys.stdin) if isinstance(a,dict) and a.get("name")==os.environ["NAME"]),""))')"
  # ⛔ APPKU S JINÝM ZPŮSOBEM SESTAVENÍ TENHLE SKRIPT NESPRAVUJE (naměřeno 2026-09-03).
  #
  # Tenhle provisioner zná JEDEN model povrchu: samostatná Coolify appka
  # `build_pack=dockerfile` nad deploy/surface-host/Dockerfile. Instance ale
  # může tentýž povrch provozovat jinak — `<fork>` má `*-extranet` jako
  # compose stack na téže veřejné doméně. Reconcile níž je bezpodmínečný PATCH
  # (`build_pack`, `dockerfile_location`, `ports_exposes`, `domains`), takže by
  # cizí appku PŘESTAVĚL na model, kterým nasazená není — a instance by přišla
  # o běžící povrch. Zvenku by to vypadalo jako „provisioning proběhl".
  #
  # Klient v Keycloaku je přitom potřeba TAK JAKO TAK: shell povrchu se jím
  # přihlašuje bez ohledu na to, čím je appka postavená. Chybějící klient je
  # HTTP 400 „Klient nebyl nalezen" na přihlašovací obrazovce (naměřeno
  # 2026-09-03 na <fork>-extranet).
  #
  # Proto se ty dvě věci rozdělují: appku spravujeme jen tehdy, když ji tenhle
  # skript založil nebo když je opravdu surface-host; klienta zakládáme vždy.
  spravujeme_appku=1
  if [ -n "$existing" ]; then
    uuid="$existing"
    zpusob="$(cf "$CB/api/v1/applications/$uuid" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("build_pack") or "")')"
    if [ "$zpusob" = "dockerfile" ]; then
      log "  Coolify app exists ($uuid, build_pack=dockerfile) — reconcile"
    else
      spravujeme_appku=0
      warn "  Coolify app $app existuje, ale build_pack='${zpusob:-?}' (ne dockerfile)."
      warn "    Povrch je nasazený JINÝM modelem než surface-host — appku nechávám být,"
      warn "    aby se nepřestavěla a instance nepřišla o běžící povrch."
      warn "    Pokračuji klientem v Keycloaku; ten je potřeba tak jako tak."
    fi
  else
    payload="$(COOLIFY_PROJECT_UUID="$COOLIFY_PROJECT_UUID" ENV_NAME="$ENV_NAME" SERVER_UUID="$SERVER_UUID" \
      DEST_UUID="$DEST_UUID" APP="$app" SHELL="$shell" SLUG="$SLUG" AISHA_SURFACE_REPO="$AISHA_SURFACE_REPO" \
      BRANCH="$BRANCH" FQDN="$fqdn" python3 -c 'import json,os;print(json.dumps({
      "project_uuid":os.environ["COOLIFY_PROJECT_UUID"],"environment_name":os.environ["ENV_NAME"],
      "server_uuid":os.environ["SERVER_UUID"],"destination_uuid":os.environ["DEST_UUID"],
      "name":os.environ["APP"],"description":"Surface: "+os.environ["SHELL"]+" for "+os.environ["SLUG"],
      "git_repository":os.environ["AISHA_SURFACE_REPO"],"git_branch":os.environ["BRANCH"],
      "build_pack":"dockerfile","dockerfile_location":"/deploy/surface-host/Dockerfile",
      "ports_exposes":"8080","domains":os.environ["FQDN"],"instant_deploy":False}))')"
    uuid="$(cf -X POST "$CB/api/v1/applications/public" -d "$payload" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("uuid",""))')"
    [ -n "$uuid" ] || { warn "  create failed for $app — skip"; continue; }
    log "  created Coolify app $uuid"
  fi

  if [ "$spravujeme_appku" = "1" ]; then
  # /applications/public normalises the git URL and can drop the token → SSH
  # clone that fails on a private repo. Force the full token-in-URL + build args.
  cf -X PATCH "$CB/api/v1/applications/$uuid" -d "$(AISHA_SURFACE_REPO="$AISHA_SURFACE_REPO" BRANCH="$BRANCH" FQDN="$fqdn" python3 -c 'import json,os;print(json.dumps({
    "git_repository":os.environ["AISHA_SURFACE_REPO"],"git_branch":os.environ["BRANCH"],
    "domains":os.environ["FQDN"],"dockerfile_location":"/deploy/surface-host/Dockerfile","ports_exposes":"8080"}))')" >/dev/null || warn "  git PATCH failed for $app"
  # Build args select the shell + instance overlay (Dockerfile defaults are the
  # workbench extranet; other surfaces must override).
  #
  # SURFACE_OVERLAY_CACHEBUST musí být hodnota, která se změní právě tehdy, když
  # se změnil overlay — jinak BuildKit klon zakešuje a povrch se nasadí s
  # obsahem instančního repa z prvního buildu (zeleně a beze změny; pozná se
  # až očima). Odvozujeme ji z HEAD vzdáleného repa, ne z času: přestavba pak
  # nastane, když je proč. Dockerfile na prázdnou hodnotu spadne schválně.
  OVERLAY_BUST=""
  if [ -n "${SURFACE_OVERLAY_GIT_URL:-}" ]; then
    # Cesta od TOHOTO skriptu, ne od cwd — provision se spouští odkudkoli.
    OVERLAY_BUST="$("$(dirname "${BASH_SOURCE[0]}")/deploy/overlay-cachebust.sh" \
      "$SURFACE_OVERLAY_GIT_URL" "${SURFACE_OVERLAY_REF:-}")" \
      || {
        # ⛔ Tady stálo `warn` + prázdná hodnota, tedy fallback: overlay je
        # DEKLAROVANÝ, jen jsme nezjistili, na čem stojí. Pokračovat znamenalo
        # doběhnout až do buildu a spadnout tam na stráži v Dockerfilu — daleko
        # od příčiny a o desítky minut později. Nevíme-li, končíme tady.
        warn "  overlay cachebust: HEAD instančního repa se nepodařilo přečíst."
        warn "    Overlay je deklarovaný (URL se nevypisuje — nese pověření), takže tohle není"
        warn "    stav 'instance overlay nemá' — je to nezměřený stav. Build by buď spadl"
        warn "    na stráži v deploy/surface-host/Dockerfile, nebo nasadil STARÝ overlay."
        exit 1
      }
    [ -n "$OVERLAY_BUST" ] && log "  overlay cachebust=${OVERLAY_BUST}"
  fi
  # PATCH v Coolify jen PŘEPISUJE: nad klíčem, který na appce ještě není, vrací
  # 404 "Environment variable not found". Původní `|| true` to spolklo, takže
  # SURFACE_OVERLAY_CACHEBUST se nikdy nezaložil a build povrchu padal na
  # prázdné hodnotě — zvenku to vypadalo, že výrobce hodnoty existuje, jen
  # „nefunguje". Naměřeno 2026-08-03: instanční extranet takhle spadl třikrát.
  # Overlay MUSÍ doputovat až do appky, ne zůstat v prostředí skriptu: build běží
  # na build serveru z env aplikace. Bez URL+PATH se povrch postaví z
  # `instances/_default`, tedy z referenční šablony — a majitel skončí na
  # `https://idp.example.invalid` (naměřeno 2026-08-22). Nic nespadne.
  for kv in "SHELL_APP=${shell}" "INSTANCE_DIR=instances/${SLUG}" \
            ${SURFACE_OVERLAY_GIT_URL:+"SURFACE_OVERLAY_GIT_URL=${SURFACE_OVERLAY_GIT_URL}"} \
            ${SURFACE_OVERLAY_PATH:+"SURFACE_OVERLAY_PATH=${SURFACE_OVERLAY_PATH}"} \
            ${SURFACE_OVERLAY_REF:+"SURFACE_OVERLAY_REF=${SURFACE_OVERLAY_REF}"} \
            ${OVERLAY_BUST:+"SURFACE_OVERLAY_CACHEBUST=${OVERLAY_BUST}"}; do
    _payload="$(K="${kv%%=*}" V="${kv#*=}" python3 -c 'import json,os;print(json.dumps({"key":os.environ["K"],"value":os.environ["V"],"is_preview":False}))')"
    cf -X PATCH "$CB/api/v1/applications/$uuid/envs" -d "$_payload" >/dev/null \
      || cf -X POST "$CB/api/v1/applications/$uuid/envs" -d "$_payload" >/dev/null \
      || warn "  env ${kv%%=*}: PATCH i POST selhaly — build povrchu na prázdné hodnotě SPADNE"
  done
  fi

  # 2) Keycloak public client (create if absent) ------------------------------
  # The client MUST carry the platform token shape — the audience + PostgREST
  # role + subject + realm-role protocol mappers — or the SPA logs in fine but
  # every API call is rejected: no `aud` for the gateway allow-list and no
  # PostgREST role claim, so data silently "fails to load". A bare public client
  # (no mappers) is the trap. Copy the mappers from the platform web client.
  cid="$app"
  tmpl="${AISHA_SURFACE_CLIENT_TEMPLATE:-aisha-app}"
  kc_cid() { curl -sf -m 20 -H "Authorization: Bearer $KTOK" "$KC/admin/realms/$REALM/clients?clientId=$1" | python3 -c 'import sys,json;a=json.load(sys.stdin);print(a[0]["id"] if a else "")'; }
  rid="$(kc_cid "$cid")" || rid=""
  if [ -n "$rid" ]; then
    log "  KC client $cid exists ($rid) — leave as-is"
  else
    cbody="$(CID="$cid" FQDN="$fqdn" python3 -c 'import json,os;
f=os.environ["FQDN"];print(json.dumps({
 "clientId":os.environ["CID"],"name":os.environ["CID"],"enabled":True,"protocol":"openid-connect",
 "publicClient":True,"standardFlowEnabled":True,"directAccessGrantsEnabled":False,"serviceAccountsEnabled":False,
 "redirectUris":[f+"/*"],"webOrigins":[f],
 "attributes":{"pkce.code.challenge.method":"S256","post.logout.redirect.uris":f+"/*"}}))')"
    code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KTOK" -H "Content-Type: application/json" -X POST "$KC/admin/realms/$REALM/clients" -d "$cbody")"
    [ "$code" = "201" ] || warn "  KC client create for $cid → HTTP $code"
    rid="$(kc_cid "$cid")" || rid=""
    if [ -n "$rid" ]; then
      log "  created KC public client $cid ($rid)"
      # Carry the platform token mappers (audience / postgrest-role / sub / realm-role).
      tid="$(kc_cid "$tmpl")" || tid=""
      if [ -n "$tid" ]; then
        maps="$(curl -sf -m 20 -H "Authorization: Bearer $KTOK" "$KC/admin/realms/$REALM/clients/$tid/protocol-mappers/models" | python3 -c 'import sys,json;ms=json.load(sys.stdin);[m.pop("id",None) for m in ms];print(json.dumps(ms))')"
        curl -sS -m 20 -o /dev/null -H "Authorization: Bearer $KTOK" -H "Content-Type: application/json" -X POST "$KC/admin/realms/$REALM/clients/$rid/protocol-mappers/add-models" -d "$maps" && log "  copied token mappers from $tmpl" || warn "  mapper copy from $tmpl failed"
      else
        warn "  template client $tmpl not found — surface token will lack aud/role mappers (API calls will 401/403)"
      fi
      # Default client scopes: openid / profile / email.
      scopes="$(curl -sf -m 20 -H "Authorization: Bearer $KTOK" "$KC/admin/realms/$REALM/client-scopes")"
      for s in openid profile email; do
        sid="$(printf '%s' "$scopes" | S="$s" python3 -c 'import sys,json,os;print(next((x["id"] for x in json.load(sys.stdin) if x["name"]==os.environ["S"]),""))')"
        [ -n "$sid" ] && curl -sS -m 15 -o /dev/null -H "Authorization: Bearer $KTOK" -X PUT "$KC/admin/realms/$REALM/clients/$rid/default-client-scopes/$sid" || true
      done
    fi
  fi

  # 3) Deploy the surface -----------------------------------------------------
  if [ "$spravujeme_appku" = "1" ]; then
    cf -X POST "$CB/api/v1/deploy?uuid=$uuid&force=false" >/dev/null && log "  deploy queued for $app" || warn "  deploy trigger failed for $app"
  else
    log "  nasazení $app nespouštím — appku spravuje jiný model (viz výše)"
  fi
done

log "done."
