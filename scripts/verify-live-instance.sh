#!/usr/bin/env bash
# Targeted post-deploy verification of a live instance.
#
# Answers, in order, the questions a deploy has to satisfy:
#   1. mesh trust  — do agents trust the CA the bridge currently serves?
#   2. schema      — did baseline + heals reach the database?
#   3. surfaces    — does every ACTIVE block render through the dispatcher?
#   4. authorization — do the fail-closed classes hold?
#
# Instance-agnostic ON PURPOSE: no app names, no block slugs, no host baked in.
# The block list is read FROM the database (surface_blocks), so this verifies
# whatever the instance actually declares rather than what its author remembered.
#
# Read-only: database work runs inside a transaction that is rolled back.
#
#   ./scripts/verify-live-instance.sh [ssh-host]     (default: $AISHA_DEPLOY_HOST)
set -uo pipefail

HOST="${1:-${AISHA_DEPLOY_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "usage: $0 <ssh-host>   (or set AISHA_DEPLOY_HOST)" >&2; exit 2
fi
PASS=0; FAIL=0; SKIP=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33m—\033[0m %s\n' "$1"; SKIP=$((SKIP+1)); }
head_(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
sshx() { ssh -o ConnectTimeout=10 "$HOST" "$@" 2>/dev/null; }
# Last non-empty line only: a statement preceded by SET (or any command tag)
# returns that tag on its own line first, and comparing the whole output against
# the expected value silently turns every such check into a false failure.
psql_q(){ sshx "docker exec -i \$(docker ps --format '{{.Names}}' | grep '^db-' | head -1) psql -U postgres -d postgres -tAc \"$1\"" | grep -v '^$' | tail -1; }

head_ "1. Mesh trust"
UNHEALTHY=$(sshx "docker ps --format '{{.Names}}|{{.Status}}' | grep -ci 'netbird.*unhealthy'" || echo "?")
case "$UNHEALTHY" in
  0) ok "no unhealthy mesh agent" ;;
  \?|"") skip "host unreachable — mesh state unknown" ;;
  *) bad "$UNHEALTHY mesh agent(s) unhealthy"
     sshx "docker logs --tail 3 \$(docker ps --format '{{.Names}}' | grep -m1 'netbird-agent') 2>&1 | tail -2" | sed 's/^/      /' ;;
esac
CERTS=$(sshx "C=\$(docker ps --format '{{.Names}}' | grep -m1 'pki-bridge'); IP=\$(docker inspect \$C --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print \$1}'); curl -fsS --max-time 8 http://\$IP:3040/diag/ca-bundle | grep -c 'BEGIN CERTIFICATE'" || echo 0)
[ "${CERTS:-0}" -gt 0 ] && ok "pki-bridge serves a realm CA ($CERTS certs)" \
                        || bad "pki-bridge serves NO certificate — containers would fail closed"

head_ "2. Schema reached the database"
# Every SoT function name, straight from the tree — no hand-kept list to rot.
# ONE round-trip: the names go over as a VALUES list and the database reports
# which of them it lacks. (Per-name queries meant 400+ ssh calls and minutes.)
NAMES=$(for F in aisha/db/sql/functions/*.sql; do printf "('%s')," "$(basename "$F" .sql)"; done | sed 's/,$//')
CHECKED=$(ls aisha/db/sql/functions/*.sql | wc -l | tr -d ' ')
MISSING_LIST=$(psql_q "select string_agg(w.n, ' ') from (values $NAMES) as w(n)
  where not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                    where ns.nspname='public' and p.proname=w.n)")
MISSING=$(printf '%s' "$MISSING_LIST" | wc -w | tr -d ' ')
[ "$MISSING" -gt 0 ] && printf '      missing: %s\n' "$(printf '%s' "$MISSING_LIST" | cut -c1-160)"
[ "$MISSING" = "0" ] && ok "all $CHECKED source-of-truth functions live" \
                     || bad "$MISSING of $CHECKED source-of-truth functions missing"

head_ "3. Surfaces render (blocks read from the database)"
SLUGS=$(psql_q "select string_agg(block_slug, ' ') from surface_blocks where is_active")
if [ -z "$SLUGS" ]; then skip "no active blocks declared"; else
  for SLUG in $SLUGS; do
    case "$(psql_q "set role service_role; select case when public.get_block_data('$SLUG','{}'::jsonb) ? 'data' then 'ok' else 'nodata' end")" in
      ok)     ok "block $SLUG renders" ;;
      nodata) bad "block $SLUG returned no data key" ;;
      *)      bad "block $SLUG errored (allowlist or producer?)" ;;
    esac
  done
fi

head_ "4. Authorization fails closed"
M=$(psql_q "select public.document_sensitivity_min_tier('public')||'/'||public.document_sensitivity_min_tier('confidential')||'/'||public.document_sensitivity_min_tier(null)")
[ "$M" = "registered/admin/admin" ] && ok "sensitivity→tier (unknown class ⇒ most restrictive): $M" \
                                    || bad "sensitivity→tier unexpected: ${M:-<none>}"
U=$(psql_q "select public.document_visible_to(gen_random_uuid(), 'sha-that-cannot-exist')")
[ "$U" = "f" ] && ok "unpromoted document invisible (promotion seam enforced)" \
               || bad "unpromoted document returned '${U:-<none>}' — expected f"

printf '\n\033[1mResult:\033[0m %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
