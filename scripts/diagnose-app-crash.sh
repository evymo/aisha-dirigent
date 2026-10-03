#!/usr/bin/env bash
# diagnose-app-crash.sh — WHY did an aisha-* app (or its containers) crash?
#
# The Coolify API only reports an aggregate app status ("exited:unhealthy") and
# build logs — it does NOT surface which CONTAINER died or WHY. This runs on the
# host (Giah/Varra/Talos, where the containers live) and prints the smoking gun:
# per-container exit code / OOM / restart-loop / last logs. The failure classes
# actually observed on this stack, in order of how often they bite:
#   1. Missing runtime dependency — ERR_MODULE_NOT_FOUND crashloop (a prod image
#      built without a dep that IS declared: monorepo hoist/prune packaging bug).
#   2. Credential drift — "password authentication failed for <role>" after a
#      shared db recreate reconciles role passwords but an app's env stayed stale.
#   3. Container teardown / vanish — Coolify shows exited:unhealthy but NO
#      container is present on the host (a co-tenant `compose down`/wipe removed it).
#   4. OOM / disk-full, and Postgres connection saturation (a check, NOT a
#      presumed cause — verify used-vs-max before blaming it).
#
# Usage (on the docker host):
#   ./scripts/diagnose-app-crash.sh aisha-core
#   ./scripts/diagnose-app-crash.sh aisha-integration
#   ./scripts/diagnose-app-crash.sh aisha          # all aisha-* containers
#
# No SSH? Run the individual docker commands it prints — nothing here is magic.
set -uo pipefail
FILTER="${1:-aisha}"
TAIL="${LOG_TAIL:-60}"
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'
hdr() { echo -e "\n${C}══ $* ══${N}"; }

command -v docker >/dev/null || { echo "docker not found — run this on the host where the containers live"; exit 1; }

# ── 1. Per-container post-mortem ─────────────────────────────────────────────
# The one question that matters: which container exited, with what code, and was
# it OOM-killed (137 + OOMKilled=true) or a clean app crash (non-zero exit)?
hdr "Containers matching '${FILTER}' — state / exit / OOM / restarts"
printf '%-42s %-11s %-5s %-4s %-7s %s\n' NAME STATE EXIT OOM RESTART FINISHED
docker ps -a --format '{{.Names}}' | grep -F "$FILTER" | sort | while read -r c; do
  read -r state exit oom restarts finished < <(docker inspect "$c" \
    --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}} {{.State.FinishedAt}}' 2>/dev/null)
  color="$N"
  [ "$oom" = "true" ] && color="$R"
  { [ "$state" = "exited" ] || [ "$state" = "restarting" ] || [ "$state" = "dead" ]; } && color="$R"
  printf "${color}%-42s %-11s %-5s %-4s %-7s %s${N}\n" "$c" "$state" "$exit" "$oom" "$restarts" "${finished%.*}"
done

# ── 2. Logs of every non-running container (the actual error) ─────────────────
hdr "Last ${TAIL} log lines of NON-healthy containers (the crash reason)"
docker ps -a --format '{{.Names}} {{.Status}}' | grep -F "$FILTER" \
  | grep -viE 'Up .*(healthy)?|Up [0-9]' | awk '{print $1}' | while read -r c; do
  echo -e "${Y}── $c ──${N}"
  docker logs --tail "$TAIL" "$c" 2>&1 | tail -n "$TAIL"
  echo
done

# ── 3. Postgres connection saturation — a CHECK, not a presumed cause ─────────
# Print used-vs-max so you can rule exhaustion in or OUT with a number instead of
# a theory. If used is nowhere near max, connection count is NOT your problem —
# look at the crash logs above (missing dep / auth drift) instead. Only if used
# ≈ max are new connections being refused (db-dependent services then fail their
# healthcheck and exit after running a while).
DBC="$(docker ps --format '{{.Names}}' | grep -F "$FILTER" | grep -E 'aisha-db|-db$' | head -1)"
[ -z "$DBC" ] && DBC="$(docker ps --format '{{.Names}}' | grep -E 'aisha-db' | head -1)"
if [ -n "$DBC" ]; then
  hdr "Postgres connections vs max_connections  (container: $DBC)"
  docker exec -i "$DBC" psql -U postgres -d postgres -Atc \
    "SELECT 'used='||count(*)||' / max='||current_setting('max_connections')||'  ('||
            round(100.0*count(*)/current_setting('max_connections')::int)||'% )' FROM pg_stat_activity;" 2>&1
  echo "  Top consumers (usename / count):"
  docker exec -i "$DBC" psql -U postgres -d postgres -Atc \
    "SELECT '  '||coalesce(usename,'(none)')||'  '||count(*) FROM pg_stat_activity GROUP BY usename ORDER BY 2 DESC LIMIT 8;" 2>&1
  echo "  Waiting / idle-in-transaction (leaks):"
  docker exec -i "$DBC" psql -U postgres -d postgres -Atc \
    "SELECT '  state='||coalesce(state,'?')||'  '||count(*) FROM pg_stat_activity GROUP BY state ORDER BY 2 DESC;" 2>&1
fi

# ── 4. Host resource pressure (OOM / disk from build churn) ───────────────────
hdr "Host resources (OOM / disk-full also crash containers)"
free -h 2>/dev/null | sed 's/^/  /' || echo "  (free unavailable)"
echo "  disk:"; df -h / /var/lib/docker 2>/dev/null | sed 's/^/  /' | sort -u
echo "  recent kernel OOM kills (if dmesg readable):"
dmesg 2>/dev/null | grep -iE 'killed process|out of memory' | tail -3 | sed 's/^/  /' || echo "  (dmesg not readable — try: journalctl -k | grep -i oom)"

echo -e "\n${G}Read it top-down:${N} an OOMKilled=true or exit 137 → memory; a red 'used≈max' → connection exhaustion (raise max_connections or restart leaking clients); a clean non-zero exit → read that container's log block above for the app error."
