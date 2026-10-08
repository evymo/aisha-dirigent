#!/bin/sh
# =============================================================================
# instance-data-hook.sh — apply the private instance seed layer at deploy time
# =============================================================================
# Runs as AISHA_IMPLEMENTATION_HOOK inside the `migrate` container (POSIX sh;
# psql + git + node are present — see Dockerfile.migrate). Invoked by
# docker-migrate-entrypoint.sh AFTER platform migrations + seeds succeed, so the
# implementation layer (stack-default story, system identity) already exists —
# exactly what the instance KB rows reference.
#
# The public repo intentionally ships NO private content and NO private
# submodule (enforced by src/tests/gates/public-oss-boundary.gate.test.ts).
# This hook is the boundary-respecting production path: the private overlay is
# fetched at RUNTIME from a git URL provided via deployment env — never baked
# into the public git metadata or the image.
#
# Env contract (all optional → community installs no-op cleanly):
#   AISHA_INSTANCE_DATA_GIT_URL   clone URL for the private overlay repo. Prefer a
#                                 TOKEN-FREE URL + the GIT_TOKEN secret (injected
#                                 at runtime, never persisted in any config artifact),
#                                 e.g. https://git.host/org/instance-data.git — matching
#                                 svc-web-artifact's design-overlay pull. A URL with
#                                 embedded creds still works (backward compatible).
#                                 Optional "#<ref>" suffix pins a branch/tag/SHA
#                                 (default: the remote default branch).
#   GIT_TOKEN                 read token used when the URL is token-free (secret
#                                 env; never logged).
#   AISHA_DB_URL                  injected by the entrypoint (normalized).
#
# Behaviour:
#   - URL unset/empty  → log + exit 0 (platform-only install; not an error).
#   - URL set          → clone (depth 1) + apply every TOP-LEVEL NN_*.sql in
#                        lexical order under ON_ERROR_STOP=1. Subdirectories
#                        (e.g. portfolio/) are opt-in content and NOT applied.
#                        Any failure exits non-zero → the migrate container
#                        (and thus the deploy) goes red. Loud > silent.
#   - operators.json   → a TOP-LEVEL operators.json in the overlay (not *.sql,
#                        so the SQL loop ignores it) is THE production operator
#                        roster (PII — private repo only). It is exported to a
#                        stable scratch path (AISHA_OPERATORS_EXPORT_FILE,
#                        default /tmp/aisha-instance-operators.json); the
#                        entrypoint hands it to provision-operators.mjs as
#                        AISHA_OPERATORS_FILE so a wipe cold-start restores
#                        operator users purely from the private instance repo —
#                        zero local files on the operator host.
#
# Idempotence: the overlay files are required to be ON CONFLICT/IF NOT EXISTS
# (same contract as every seed layer) — re-running the hook is safe.
# Credentials are never printed: the URL is redacted in every log line.
# =============================================================================
set -eu

log() { echo "[instance-data-hook] $1"; }

URL_RAW="${AISHA_INSTANCE_DATA_GIT_URL:-}"

if [ -z "$URL_RAW" ]; then
  log "AISHA_INSTANCE_DATA_GIT_URL not set — skipping private instance overlay (platform-only install)."
  exit 0
fi

# Self-heal JSON-escaped slashes: values copied from a raw Coolify API dump
# arrive as `https:\/\/oauth2:…` (PHP json_encode escapes `/` as `\/`).
# git would treat that as a relative path → clone fails with a cryptic error.
URL_RAW=$(printf '%s' "$URL_RAW" | sed 's|\\/|/|g')

if [ -z "${AISHA_DB_URL:-}" ]; then
  log "ERROR: AISHA_DB_URL is not set (the entrypoint passes it) — cannot apply instance overlay."
  exit 1
fi

command -v git >/dev/null 2>&1 || { log "ERROR: git not available in this image."; exit 1; }
command -v psql >/dev/null 2>&1 || { log "ERROR: psql not available in this image."; exit 1; }

# Split an optional "#ref" pin off the URL.
REF=""
URL="$URL_RAW"
case "$URL_RAW" in
  *"#"*)
    REF="${URL_RAW##*#}"
    URL="${URL_RAW%#*}"
    ;;
esac

# Redacted form for logs: strip userinfo (anything between :// and @).
REDACTED=$(printf "%s" "$URL" | sed -E 's|(://)[^@/]+@|\1***@|')

# Auth: if the URL carries NO credentials (token-free, no userinfo) but the
# GIT_TOKEN secret is set, inject it at RUNTIME for the clone only — matching
# svc-web-artifact/Dockerfile's design-overlay pull. The token is never persisted
# (AISHA_INSTANCE_DATA_GIT_URL stays token-free in every config artifact) nor
# logged (REDACTED is derived from the token-free URL). A URL that already embeds
# credentials is used verbatim (backward compatible).
CLONE_URL="$URL"
case "$URL" in
  *"@"*) : ;;                       # already has userinfo -> use verbatim
  https://*)
    if [ -n "${GIT_TOKEN:-}" ]; then
      CLONE_URL="https://${GIT_TOKEN}@${URL#https://}"
    fi
    ;;
esac

WORKDIR=$(mktemp -d /tmp/instance-data.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

log "Cloning instance overlay from ${REDACTED}${REF:+ (ref: $REF)} …"
if [ -n "$REF" ]; then
  # ⛔ důvod se SCHOVÁ, ne zahodí. `2>/dev/null` tu z utrženého přenosu dělalo
  # bezobsažné „clone failed", k nerozeznání od špatného pověření.
  _hk_err="$(mktemp)"
  git clone --quiet --depth 1 --filter=blob:none --branch "$REF" "$CLONE_URL" "$WORKDIR/repo" 2>"$_hk_err" \
    || { # branch/tag clone failed — try full clone + checkout (SHA pins)
         git clone --quiet --filter=blob:none "$CLONE_URL" "$WORKDIR/repo" 2>>"$_hk_err" \
           && git -C "$WORKDIR/repo" checkout --quiet "$REF"; } \
    || { log "ERROR: clone/checkout of ${REDACTED} @ ${REF} failed: $(sed -E 's|(://)[^@/]+@|\1***@|' "$_hk_err" | tr '\n' ' ')"; rm -f "$_hk_err"; exit 1; }
  rm -f "$_hk_err"
else
  # ⛔ tichý klon: bez důvodu vypadá utržený přenos jako špatné pověření.
  . "${0%/*}/../lib/git-klon.sh" 2>/dev/null || true
  { command -v klonuj >/dev/null 2>&1 && klonuj "$CLONE_URL" "$WORKDIR/repo"; } \
  || git clone --quiet --depth 1 --filter=blob:none "$CLONE_URL" "$WORKDIR/repo" \
    || { log "ERROR: clone of ${REDACTED} failed."; exit 1; }
fi

# ── Operator roster export (file-based handoff to the provision step) ────────
# The hook runs as a subshell (`sh "$IMPLEMENTATION_HOOK"`), so it cannot set
# env vars in docker-migrate-entrypoint.sh — copy the roster out of the
# (trap-cleaned) clone to a stable path instead. The entrypoint picks it up as
# AISHA_OPERATORS_FILE for provision-operators.mjs, whose roster priority is:
#   AISHA_OPERATORS_FILE > AISHA_OPERATORS env > config/operators.json >
#   AISHA_PRIMARY_ADMIN_EMAIL > realm-role fallback.
# (File first since 2026-08-07: this export is the DECLARED roster and must not
# be silenced by a cold-start snapshot frozen in AISHA_OPERATORS.)
# Emails are PII and this log feeds the anon-readable migration_log_dump →
# never print the roster contents, only its presence.
ROSTER_EXPORT="${AISHA_OPERATORS_EXPORT_FILE:-/tmp/aisha-instance-operators.json}"
if [ -f "$WORKDIR/repo/operators.json" ]; then
  cp "$WORKDIR/repo/operators.json" "$ROSTER_EXPORT"
  log "Exported overlay operators.json -> $ROSTER_EXPORT (roster for the provision step)."
else
  rm -f "$ROSTER_EXPORT"
  log "No top-level operators.json in overlay — provision step falls back to env/local roster sources."
fi

# Overlay SQL se aplikuje JAKO `service_role` — ne pod holým vlastníkem spojení.
#
# PROČ (změřeno 2026-08-10, aisha-core byl kvůli tomu down): overlay `00_kb.sql`
# vkládá do `expert_rules`. Na té tabulce visí trigger `fn_notify_rule_change()`,
# který zapisuje do `ai_runs` přes `ensure_stack_default_story()`. Ta funkce NENÍ
# `SECURITY DEFINER` — běží pod volajícím a hned zkraje ověřuje:
#     IF NOT is_service_role() AND NOT is_admin_or_staff() THEN RAISE …
# Migrace se připojuje jako `postgres`: žádné JWT claims, žádný `role` GUC, takže
# `is_service_role()` vrátí false i superuserovi a soubor spadne na
#     ERROR: Unauthorized: admin/staff or service_role required
# → hook exit=3 → kontejner `migrate` Exited(3) → gateway/web/core-mesh-ingress
# uvíznou ve stavu `Created` a core se NIKDY nerozběhne.
#
# Není to obcházení autorizace, ale její správné DORUČENÍ: `is_service_role()`
# sama nabízí druhou cestu `current_setting('role') = 'service_role'` právě pro
# neinteraktivní systémové zápisy. Hromadný import dat instance takový zápis JE.
#
# Ověřeno na živé DB:
#   bez role                       → is_service_role() = f
#   PGOPTIONS=-c role=service_role → role GUC = service_role, is_service_role() = t
#
# Proč to nechytil seed: `db:seed` běží DŘÍV, než ty triggery vzniknou — rodina
# `feedback_coldstart_inline_trigger_rls_ordering`. Zelený seed o tomhle tedy
# nevypovídá nic.
# ⭐ DATA INSTANCE VIDÍ SAMA SEBE (2026-09-24, domluveno RIQ Driver + RIQi). SQL
# v datech instance si smí načíst SOUSEDNÍ soubor (např. `zarizeni/hlidac.json` →
# `\set dekl \`cat "$AISHA_INSTANCE_DATA_DIR"/zarizeni/hlidac.json\``), takže JSON
# zůstane jediným zdrojem pravdy a do SQL se neopisuje. psql běží s absolutní
# cestou `-f` a pracovní adresář NENÍ v klonu — proto proměnná, ne relativní cesta.
# Commit se předává kvůli dohledatelnosti (která verze dat je v DB).
AISHA_INSTANCE_DATA_DIR="$WORKDIR/repo"
AISHA_INSTANCE_DATA_COMMIT="$(git -C "$WORKDIR/repo" rev-parse HEAD 2>/dev/null || echo '')"
export AISHA_INSTANCE_DATA_DIR AISHA_INSTANCE_DATA_COMMIT

APPLIED=0
for f in "$WORKDIR"/repo/*.sql; do
  [ -e "$f" ] || break
  log "Applying $(basename "$f") … (jako service_role)"
  PGOPTIONS="-c role=service_role" psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  APPLIED=$((APPLIED + 1))
done

if [ "$APPLIED" -eq 0 ]; then
  log "ERROR: overlay repo contains no top-level *.sql — refusing to treat an empty overlay as success."
  exit 1
fi

log "Done — applied $APPLIED instance overlay file(s)."
