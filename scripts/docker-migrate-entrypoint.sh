#!/bin/sh
# AISHA DB migration entrypoint
# Runs migrations + seeds. Persists captured output to public.migration_log_dump
# (queryable via PostgREST) for diagnostic visibility — the deployment surface
# only sees `docker compose up -d` exit codes, not container stdout.
# AISHA_MIGRATE_DEBUG_HOLD=1 forces exit 0 so dependents start even on failure.

# ⛔ NAMĚŘENO 2026-08-19: tady stálo `:-postgresql://postgres:postgres@aisha-db:…`
# — adresa CIZÍ instance a k tomu heslo natvrdo. Compose přitom AISHA_DB_URL
# PŘEDÁVÁ, a to instančně (`${APP_NAME_PREFIX:?}-db`), takže fallback nikdy
# nevystřelil. Právě proto by se na něj přišlo až ve chvíli, kdy by proměnná
# chyběla — a migrace by tiše mířila na cizí databázi.
DB_URL_RAW="${AISHA_DB_URL:-${DATABASE_URL:?ani AISHA_DB_URL, ani DATABASE_URL nejsou nastavené — adresa databáze se NEHÁDÁ}}"

# Defensive: Coolify v4 may inject env values wrapped in single quotes
# (real_value="'WJQ…'"). When that leaks into the runtime URL substitution,
# we end up with `postgresql://aisha_admin:'WJQ…'@db:5432/postgres` which
# psql parses as a 26-char password, while initdb stored a 24-char hash.
# Strip a literal pair of surrounding single OR double quotes inside the
# password component (between `:` and `@`) if present.
DB_URL=$(printf "%s" "$DB_URL_RAW" \
  | sed -E "s|^(postgres(ql)?://[^:]+:)'([^@]*)'(@.*)$|\\1\\3\\4|" \
  | sed -E "s|^(postgres(ql)?://[^:]+:)\"([^@]*)\"(@.*)$|\\1\\3\\4|")
MIGRATE_OUT=/tmp/migrate-output.log
mkdir -p /tmp
: > "$MIGRATE_OUT"

log() { echo "[migrate] $1" | tee -a "$MIGRATE_OUT"; }

write_dump() {
  STATUS="$1"
  EXIT_CODE="$2"
  CANONICAL_STATUS="$STATUS"
  if [ "$CANONICAL_STATUS" != "ok" ] && [ "$CANONICAL_STATUS" != "running" ]; then
    CANONICAL_STATUS="error"
  fi
  # ⛔ NÁLEZ 2026-09-23 (obhlídka forku, změřeno READ ONLY na jeho produkci):
  # padlý seed vypsal `Command failed: psql postgresql://aisha_admin:<HESLO>@…`
  # a tenhle zápis ho uložil do migration_log_dump — 2 řádky z 23, tabulku čte
  # `anon` přes veřejné PostgREST. Příčina je opravená u zdroje (heslo jde psql
  # prostředím, scripts/db/lib/psql-pripojeni.mjs); tohle je pojistka na JEDINÉM
  # místě, kudy výstup do veřejně čitelné tabulky vede, pro cokoli, co by adresu
  # s heslem vypsalo příště. Maskuje se SOUBOR, dřív než se z něj cokoli čte
  # (TAIL, řádky s chybou, kontext) — ne každé čtení zvlášť. Nepodaří-li se to,
  # výstup se nezapíše vůbec: nezamaskovaný výpis je horší než žádný.
  # Výraz drží v synchronu s bezHesla() v psql-pripojeni.mjs (brána je porovná).
  if ! sed -E -i 's#(postgres(ql)?://[^:/@[:space:]]+:)[^[:space:]]*@#\1***@#g' "$MIGRATE_OUT"; then
    printf '%s\n' "[migrate] výstup se nepodařilo zamaskovat — do veřejně čitelného záznamu ho nezapisuji" >"$MIGRATE_OUT"
  fi
  # ⛔ E-MAILY (NAMĚŘENO 2026-10-01, audit veřejného vydání): výstup nese adresy operátorů —
  # řádky provisioningu `✓ <e-mail> → …` i dřívější `PROVISION_GRANTED email=<e-mail>` — a
  # tabulku čte `anon` přes veřejné /rest/v1 (seznam správců instance pro kohokoli). Ověření
  # cold-startu stojí na otisku (email_sha256 níž), adresu samotnou nepotřebuje nikdo.
  # Na hesla v URL nesahá (`***@host` lokální část nemá). Nepodaří-li se, nezapisuje se nic.
  if ! sed -E -i 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<e-mail>/g' "$MIGRATE_OUT"; then
    printf '%s\n' "[migrate] e-maily se nepodařilo zamaskovat — do veřejně čitelného záznamu výstup nezapisuji" >"$MIGRATE_OUT"
  fi
  # Write SQL to a temp file then `psql -f`. Three previous approaches all
  # silently failed even when the hook's own psql calls worked (proof:
  # the tenant-hook run table has entries even when migration_log_dump doesn't):
  #   1. `psql -c "INSERT ... '${TAIL}'"` with sed-quote-doubling (PR original)
  #   2. heredoc with dollar-quoted strings ($tag$...$tag$) (PR #23)
  #   3. `psql -v out="$TAIL" ... :'out'` (PR #24)
  # Common failure mode was the shell parameter expansion of a large TAIL
  # (30KB) interacting weirdly with BusyBox `sh`. By writing the SQL to a
  # tempfile via `printf` we keep the bytes out of argv entirely and let
  # psql read them as plain input.
  #
  # GRANT TO service_role added — PostgREST connects as `authenticator` and
  # switches to `service_role` for elevated requests. While service_role
  # inherits `authenticated` per init_roles_schemas.sql, the inherited grant
  # was insufficient for PostgREST schema-cache visibility on a live instance
  # (table existed but PGRST kept returning PGRST205 not-in-cache). Explicit
  # grant fixes it.
  TAIL=$(tail -n 400 "$MIGRATE_OUT" 2>/dev/null)
  RUN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)
  # ⛔ NAMĚŘENO 2026-09-07: escapování se počítalo AŽ ZA oběma zápisy níž, takže
  # do nich šel TAIL syrový. Výstup migrace běžně nese apostrofy (SQL instančních
  # dat), literál se ukončil uprostřed a Postgres četl `demo` jako identifikátor:
  #     ERROR: syntax error at or near "demo"
  # Zápis si tak vyrobil VLASTNÍ chybu, ta byla v logu jediná viditelná a
  # PŘEBILA skutečnou příčinu (stack depth limit exceeded). Produkce byla dole
  # 40 minut a příčinu jsme dva hledali tři čtvrtě hodiny.
  # Escapuje se proto HNED, jedním místem pro všechny zápisy níž.
  ESC_TAIL_EARLY=$(printf '%s' "$TAIL" | sed "s/'/''/g")
  ESC_STATUS_EARLY=$(printf '%s' "$STATUS" | sed "s/'/''/g")
  ESC_CSTATUS_EARLY=$(printf '%s' "$CANONICAL_STATUS" | sed "s/'/''/g")
  psql "$DB_URL" -v ON_ERROR_STOP=0 -c \
    "CREATE TABLE IF NOT EXISTS public.migration_log_dump (
       id BIGSERIAL PRIMARY KEY,
       created_at TIMESTAMPTZ DEFAULT now(),
       status TEXT,
       exit_code INT,
       output TEXT
     );
     GRANT SELECT ON public.migration_log_dump TO anon, authenticated;
     INSERT INTO public.migration_log_dump (status, exit_code, output)
       VALUES ('${ESC_STATUS_EARLY}', ${EXIT_CODE}, '${ESC_TAIL_EARLY}');
     NOTIFY pgrst, 'reload schema';" \
    >>"$MIGRATE_OUT" 2>&1 || true
  # ↑ NOTIFY pgrst: PostgREST caches its schema, and this table is CREATE-TABLE-
  #   IF-NOT-EXISTS'd here on first boot — without a reload it would 404 the
  #   table (PGRST205) until the next core restart, which is exactly the window
  #   the warmup truth-check reads it in (verify 2026-07-19). db-channel is
  #   enabled by default so the running PostgREST reloads on this NOTIFY.
  # Also record into the canonical aisha_meta.migration_log audit table
  # (created by infra/postgres/000_init_roles_schemas.sql).
  psql "$DB_URL" -v ON_ERROR_STOP=0 -c \
    "INSERT INTO aisha_meta.migration_log
       (run_id, finished_at, status, exit_code, error_message)
     VALUES ('${RUN_ID}'::uuid, now(), '${ESC_CSTATUS_EARLY}', ${EXIT_CODE}, '${ESC_TAIL_EARLY}')
     ON CONFLICT DO NOTHING;" \
    >>"$MIGRATE_OUT" 2>&1 || true
  # Old-school sed-escape single quotes inside string literals. Safe because
  # the escaped string lives in a file consumed by psql (NOT shell-interpolated).
  ESC_TAIL=$(printf '%s' "$TAIL" | sed "s/'/''/g")
  ESC_STATUS=$(printf '%s' "$STATUS" | sed "s/'/''/g")
  ESC_CSTATUS=$(printf '%s' "$CANONICAL_STATUS" | sed "s/'/''/g")
  # Extract the LAST `ERROR:` line from MIGRATE_OUT — most-actionable
  # diagnostic, always small enough to escape safely. Combined with the
  # surrounding ±5 lines of context.
  # ⛔ NAMĚŘENO 2026-09-07: tady stálo `| tail -1`, tedy POSLEDNÍ chyba. Jenže
  # poslední je nejvzdálenější NÁSLEDEK — u nás doslova neúspěšný zápis záznamu
  # o chybě. Zapisovač pak ohlásil jako příčinu to, že se mu nepodařilo ohlásit
  # příčinu. `tail -1` byl náhradou za rozhodnutí, které nikdo neudělal: která
  # z chyb je příčinná? Prakticky PRVNÍ; zbytek jsou následky. Ukládají se proto
  # VŠECHNY v pořadí (ať rozhoduje čtenář) a kontext se bere kolem PRVNÍ.
  ERROR_LINES_ALL=$(grep -nE "ERROR:|FATAL:" "$MIGRATE_OUT" 2>/dev/null | head -20)
  ERROR_LINE=$(printf '%s' "$ERROR_LINES_ALL" | head -1)
  ERROR_LINE_NUM=$(printf '%s' "$ERROR_LINE" | cut -d: -f1)
  if [ -n "$ERROR_LINE_NUM" ] && [ "$ERROR_LINE_NUM" -gt 0 ] 2>/dev/null; then
    CTX_START=$((ERROR_LINE_NUM - 5))
    [ "$CTX_START" -lt 1 ] && CTX_START=1
    CTX_END=$((ERROR_LINE_NUM + 5))
    ERROR_CONTEXT=$(sed -n "${CTX_START},${CTX_END}p" "$MIGRATE_OUT" 2>/dev/null)
  else
    ERROR_CONTEXT="(no ERROR/FATAL line found in MIGRATE_OUT)"
  fi
  # Do záznamu jde CELÝ řetěz chyb v pořadí, ne jen ta vybraná: který článek je
  # příčina a který následek, pozná čtenář z pořadí — nástroj to hádat nemá.
  ERROR_CONTEXT="${ERROR_CONTEXT}
--- všechny chyby v pořadí (první je zpravidla příčina) ---
${ERROR_LINES_ALL}"
  ESC_ERROR_CONTEXT=$(printf '%s' "$ERROR_CONTEXT" | sed "s/'/''/g")

  # Write the verbose dump (with ESC_TAIL) in a SEPARATE psql invocation
  # from a FIRST minimal-row INSERT. Past experience: when ESC_TAIL is
  # large (~30KB) and contains shell-escaped UTF-8 from migrate output,
  # the INSERT inside a multi-statement -f file can silently fail per-
  # statement even with ON_ERROR_STOP=0 → psql still returns 0 because
  # NO statement aborted the file, so the wrapper's `if psql; then`
  # branch lies "succeeded". Split into minimal first (so we always have
  # a row that proves we got here, AND the canonical ERROR line) +
  # verbose attempt (may fail; we don't care).
  MINIMAL_SQL=/tmp/migrate-dump-min-$$.sql
  {
    printf 'CREATE TABLE IF NOT EXISTS public.migration_log_dump (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), status TEXT, exit_code INT, output TEXT);\n'
    printf 'GRANT SELECT ON public.migration_log_dump TO anon, authenticated, service_role;\n'
    printf 'CREATE SCHEMA IF NOT EXISTS aisha_meta;\n'
    printf 'CREATE TABLE IF NOT EXISTS aisha_meta.migration_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, status text, exit_code int, applied_migrations text[], error_message text, env_info jsonb);\n'
    # ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>. `CREATE TABLE IF NOT EXISTS` výš je
    # NO-OP, když tabulka existuje — a v DB má constraint z dřívějška povolující jen
    # 'running','ok','error'. Tenhle skript ale zapisuje i 'seed_failed' a
    # 'implementation_hook_failed', tedy PRÁVĚ ty poruchové stavy:
    #   ERROR: new row for relation "migration_log" violates check constraint
    #          "migration_log_status_check"   DETAIL: … (…, seed_failed, 1, …)
    # Projde-li migrace, zapíše se 'ok' a nikdo si ničeho nevšimne. Selže-li, selže
    # i zápis diagnostiky — příčina se ztratí přesně ve chvíli, kdy je potřeba.
    # Zapisovatel proto sladí schéma se stavy, které umí vyprodukovat.
    printf 'ALTER TABLE aisha_meta.migration_log DROP CONSTRAINT IF EXISTS migration_log_status_check;\n'
    printf 'ALTER TABLE aisha_meta.migration_log ADD CONSTRAINT migration_log_status_check CHECK (status IN (%s));\n' \
      "'running', 'ok', 'error', 'seed_failed', 'implementation_hook_failed'"
    printf 'GRANT USAGE ON SCHEMA aisha_meta TO service_role, authenticated, authenticator;\n'
    printf 'GRANT SELECT, INSERT, UPDATE ON aisha_meta.migration_log TO service_role;\n'
    printf 'GRANT SELECT ON aisha_meta.migration_log TO authenticated, authenticator;\n'
    # Minimal row uses ONLY static text — guaranteed safe to escape. The
    # ESC_ERROR_CONTEXT is attached via a SEPARATE UPDATE later so any
    # encoding issue in the extracted context cannot block this minimal row.
    printf "INSERT INTO aisha_meta.migration_log (run_id, finished_at, status, exit_code, error_message) VALUES ('%s'::uuid, now(), '%s', %s, 'write_dump minimal row — context UPDATE follows');\n" "$RUN_ID" "$ESC_CSTATUS" "$EXIT_CODE"
    printf "NOTIFY pgrst, 'reload schema';\n"
  } > "$MINIMAL_SQL"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MINIMAL_SQL" >>"$MIGRATE_OUT" 2>&1; then
    log "write_dump: minimal INSERT succeeded for status=$STATUS exit=$EXIT_CODE"
  else
    log "write_dump: ⚠ minimal INSERT FAILED for status=$STATUS exit=$EXIT_CODE (see MIGRATE_OUT)"
  fi
  rm -f "$MINIMAL_SQL"

  # FIRST attempt the small ERROR-context UPDATE — this is much smaller
  # than ESC_TAIL and most likely to succeed. We do this BEFORE attempting
  # the verbose dump so that even if the verbose attempt fails, the row
  # at least has the error line we extracted.
  CONTEXT_SQL=/tmp/migrate-dump-ctx-$$.sql
  {
    printf "UPDATE aisha_meta.migration_log SET error_message = 'write_dump (ctx attached). ERROR context (±5 lines): %s' WHERE run_id = '%s'::uuid;\n" "$ESC_ERROR_CONTEXT" "$RUN_ID"
  } > "$CONTEXT_SQL"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$CONTEXT_SQL" >>"$MIGRATE_OUT" 2>&1; then
    log "write_dump: context UPDATE succeeded"
  else
    log "write_dump: ⚠ context UPDATE FAILED (minimal row still has static text)"
  fi
  rm -f "$CONTEXT_SQL"

  # Now attempt the verbose dump (with the migrate output tail). May fail
  # silently if ESC_TAIL has problematic content — that's why minimal
  # + context above are the authoritative success indicators.
  VERBOSE_SQL=/tmp/migrate-dump-verbose-$$.sql
  {
    printf "INSERT INTO public.migration_log_dump (status, exit_code, output) VALUES ('%s', %s, '%s');\n" "$ESC_STATUS" "$EXIT_CODE" "$ESC_TAIL"
    printf "UPDATE aisha_meta.migration_log SET error_message = error_message || '\\n\\n--- FULL TAIL ---\\n%s' WHERE run_id = '%s'::uuid;\n" "$ESC_TAIL" "$RUN_ID"
  } > "$VERBOSE_SQL"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$VERBOSE_SQL" >>"$MIGRATE_OUT" 2>&1; then
    log "write_dump: verbose dump succeeded"
  else
    log "write_dump: ⚠ verbose dump FAILED (minimal row above is the canonical record; tail may have unprintables)"
  fi
  rm -f "$VERBOSE_SQL"
}

# write_running_marker — called BEFORE npm run db:migrate to leave an
# observable trace in BOTH public.migration_log_dump and aisha_meta.migration_log
# even when later steps crash (npm OOM, baseline psql ON_ERROR_STOP=1 →
# process.exit(1), tenant-hook silent kill).
#
# IMPORTANT: aisha_meta.migration_log is the durable witness. When
# AISHA_DB_FORCE_BASELINE_RESET=1, migrate.mjs calls DROP SCHEMA public
# CASCADE which deletes the public.migration_log_dump row written here.
# aisha_meta is NEVER touched by baseline reset (the reset is intentionally
# scoped to public so platform metadata + audit chain survives), so the
# `running` marker in aisha_meta is the only one that proves "yes migrate
# entered this run" after a force-reset crash.
write_running_marker() {
  RUN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)
  SQL_FILE=/tmp/migrate-marker-$$.sql
  {
    printf 'CREATE TABLE IF NOT EXISTS public.migration_log_dump (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), status TEXT, exit_code INT, output TEXT);\n'
    printf 'GRANT SELECT ON public.migration_log_dump TO anon, authenticated, service_role;\n'
    printf "INSERT INTO public.migration_log_dump (status, exit_code, output) VALUES ('running', NULL, 'entrypoint reached pre-migrate marker');\n"
    # Defensive: aisha_meta + aisha_meta.migration_log usually already
    # exists (created by init_roles_schemas.sql on fresh PG init), but
    # `CREATE TABLE IF NOT EXISTS` makes us survive the rare case of
    # an old PG volume that pre-dates the platform metadata schema.
    printf 'CREATE SCHEMA IF NOT EXISTS aisha_meta;\n'
    printf 'CREATE TABLE IF NOT EXISTS aisha_meta.migration_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, status text, exit_code int, applied_migrations text[], error_message text, env_info jsonb);\n'
    # Viz poznámka u prvního výskytu: schéma se sladí se zapisovanými stavy.
    printf 'ALTER TABLE aisha_meta.migration_log DROP CONSTRAINT IF EXISTS migration_log_status_check;\n'
    printf 'ALTER TABLE aisha_meta.migration_log ADD CONSTRAINT migration_log_status_check CHECK (status IN (%s));\n' \
      "'running', 'ok', 'error', 'seed_failed', 'implementation_hook_failed'"
    # GRANT USAGE to authenticator too — PostgREST runs schema-cache
    # introspection as the connection role (authenticator) BEFORE any
    # JWT-driven role switch. Without USAGE on aisha_meta, introspection
    # fails with PGRST002 the moment PGRST_DB_SCHEMAS contains aisha_meta,
    # which would otherwise loop forever (PostgREST keeps retrying).
    printf 'GRANT USAGE ON SCHEMA aisha_meta TO service_role, authenticated, authenticator;\n'
    printf 'GRANT SELECT, INSERT, UPDATE ON aisha_meta.migration_log TO service_role;\n'
    printf 'GRANT SELECT ON aisha_meta.migration_log TO authenticated, authenticator;\n'
    printf "INSERT INTO aisha_meta.migration_log (run_id, status, error_message) VALUES ('%s'::uuid, 'running', 'entrypoint reached pre-migrate marker');\n" "$RUN_ID"
    printf "NOTIFY pgrst, 'reload schema';\n"
  } > "$SQL_FILE"
  if psql "$DB_URL" -v ON_ERROR_STOP=0 -f "$SQL_FILE" >>"$MIGRATE_OUT" 2>&1; then
    log "write_running_marker: pre-migrate row inserted ok (run_id=$RUN_ID)"
  else
    log "write_running_marker: ⚠ pre-migrate row FAILED to insert (see MIGRATE_OUT)"
  fi
  rm -f "$SQL_FILE"
}

log "=== AISHA Migration Entrypoint ==="
log "Date: $(date)"
log "AISHA_DB_URL set: $(test -n "$AISHA_DB_URL" && echo yes || echo no)"
log "DEBUG_HOLD: ${AISHA_MIGRATE_DEBUG_HOLD:-0}"
log "node: $(node --version 2>&1 || echo NOT_FOUND)"
log "psql: $(psql --version 2>&1 | head -1 || echo NOT_FOUND)"
log "migrations count: $(ls -1 aisha/db/migrations/*.sql 2>/dev/null | wc -l)"

# Diagnostic: confirm whether Coolify wrapped POSTGRES_PASSWORD in quotes.
# We log only LENGTHS — never the secret itself.
log "diag: raw POSTGRES_PASSWORD len=${#POSTGRES_PASSWORD}"
log "diag: raw DB_URL len=${#DB_URL_RAW}"
log "diag: normalized DB_URL len=${#DB_URL} (drift=$(( ${#DB_URL_RAW} - ${#DB_URL} )))"

# Safety net: if pki-init race causes the CA bundle to be missing,
# Node will crash on startup with ENOENT. Surface a clear message and
# unset NODE_EXTRA_CA_CERTS so npm run db:migrate can still succeed
# (psql does not need this var; HTTPS calls outside the cluster don't
# happen during migration). pki-init is now in depends_on, but this
# stays as a belt-and-braces safeguard.
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ ! -f "$NODE_EXTRA_CA_CERTS" ]; then
  log "⚠ NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS missing on disk — unsetting to avoid Node ENOENT crash"
  unset NODE_EXTRA_CA_CERTS
fi

log "Testing DB connection..."
psql "$DB_URL" -c 'SELECT 1' >>"$MIGRATE_OUT" 2>&1
DB_OK=$?
log "DB connection exit=$DB_OK"

# Drop an early "running" marker BEFORE attempting migrate. If migrate
# crashes hard (e.g. baseline ON_ERROR_STOP killing the node process before
# write_dump runs), this row is the only thing telling us the entrypoint
# even reached the migrate step.
write_running_marker

log "Running: npm run db:migrate"
npm run db:migrate >>"$MIGRATE_OUT" 2>&1
MIGRATE_EXIT=$?
log "npm run db:migrate exit=$MIGRATE_EXIT"

if [ "$MIGRATE_EXIT" = "0" ]; then
  # Compile the seed for the configured profile BEFORE applying it. Env-driven:
  # prod=instance (platform + selected implementation + private overlay),
  # clean/community install=platform, demo=public showcase. Demo is never
  # silently included in prod. Falls back to the committed seed.compiled.sql if
  # the compile step is unavailable.
  SEED_PROFILE="${AISHA_SEED_PROFILE:-instance}"
  # ⚠️ ŽÁDNÝ default na „aisha". Tahle hodnota vybírá, ČÍ instanční data se
  # nasypou do databáze — dosazená cizí implementace by do instanční DB naseedovala
  # cizí obsah, a to je horší než neseedovat vůbec.
  SEED_IMPLEMENTATION="${AISHA_IMPLEMENTATION:-${AISHA_STORY:-${STORY:-}}}"
  # Implementaci potřebují JEN profily, které implementační vrstvu skládají
  # (scripts/db/compile-seed.mjs includesImplementation). platform/dev/demo ji
  # nečtou — lokální stack (AISHA_SEED_PROFILE=dev) by jinak padal na exit 2,
  # přestože žádná cizí data nehrozí.
  case "$SEED_PROFILE" in
    implementation|instance|full) SEED_NEEDS_IMPLEMENTATION=1 ;;
    *) SEED_NEEDS_IMPLEMENTATION=0 ;;
  esac
  if [ "$SEED_NEEDS_IMPLEMENTATION" = "1" ] && [ -z "$SEED_IMPLEMENTATION" ]; then
    log "FATAL: AISHA_IMPLEMENTATION/AISHA_STORY nejsou nastavené — nevím, ČÍ instanční seed mám sestavit."
    log "       Dosazení výchozí hodnoty by naseedovalo data jiné instance. Nastav AISHA_IMPLEMENTATION."
    exit 2
  fi
  log "Compiling seed (profile=$SEED_PROFILE implementation=$SEED_IMPLEMENTATION)"
  # ⛔ ŽÁDNÝ FALLBACK NA ZAKOMMITOVANÝ SEED. Tady stálo
  #     || log "WARN compile-seed failed — falling back to committed seed.compiled.sql"
  # a bylo to v přímém rozporu s komentářem o pár řádků výš („Demo is never
  # silently included in prod") i se stráží hned nad tím, která odmítá HÁDAT
  # implementaci a končí `exit 2`.
  #
  # NAMĚŘENO 2026-09-04: zakommitovaný `seed.compiled.sql` nese v hlavičce
  #     Profile: demo · Implementation: (none)
  #     Source: seed/core/, seed/translations/, seed/demo/
  # Fallback tedy při selhání kompilace sypal do PRODUKCE demo data — tiše,
  # jen s `WARN`. Blok, který o tři řádky výš odmítá dosadit implementaci,
  # protože „by naseedoval data jiné instance", ji vzápětí dosazoval sám.
  #
  # ⭐ Nejistota o tom, ČÍ data se sypou, je STOP. Neseedovat je vratné;
  # naseedovat cizí obsah do produkční databáze ne.
  # Výstup mimo aisha/db: lokální stack ho připojuje z pracovního stromu jen pro
  # čtení a zakommitovaný seed.compiled.sql se nesmí přepisovat. db:seed čte
  # právě tenhle soubor (AISHA_SEED_FILE).
  SEED_OUT="${AISHA_SEED_FILE:-/tmp/aisha-seed.compiled.sql}"
  if ! node scripts/db/compile-seed.mjs \
    --profile="$SEED_PROFILE" \
    --implementation="$SEED_IMPLEMENTATION" \
    --output="$SEED_OUT" >>"$MIGRATE_OUT" 2>&1; then
    log "FATAL: compile-seed selhal (profile=$SEED_PROFILE implementation=$SEED_IMPLEMENTATION)."
    log "       NEPOKRAČUJU: zakommitovaný seed.compiled.sql je profil 'demo' bez"
    log "       implementace — do téhle databáze by nasypal CIZÍ obsah."
    log "       Oprav kompilaci; neseedovaná DB je vratný stav, cizí data ne."
    exit 3
  fi

  log "Running: npm run db:seed ($SEED_OUT)"
  AISHA_SEED_FILE="$SEED_OUT" npm run db:seed >>"$MIGRATE_OUT" 2>&1
  SEED_EXIT=$?
  log "npm run db:seed exit=$SEED_EXIT"
  FINAL_EXIT=$SEED_EXIT
  if [ "$SEED_EXIT" = "0" ]; then STATUS=ok; else STATUS=seed_failed; fi
else
  FINAL_EXIT=$MIGRATE_EXIT
  STATUS=error
fi

# ── Reconcile the self-hosted LLM gateway endpoint to the derived URL ───────
# The provider catalog (19_ai_provider_catalog.sql) seeds llm-gateway with the
# in-cluster alias http://llm-gateway:4000/v1. When the deploy supplies the
# DERIVED AISHA_LLM_GATEWAY_URL (an internal/mesh domain — NEVER the public API
# gateway), point the registry row at it so the resolver dispatches to the real
# gateway. Idempotent; never touches is_enabled. The public-zone guard is a
# fail-safe: anything under the instance's PUBLIC_TLD is the public API gateway
# plane (a DIFFERENT service; the LLM gateway lives on the internal plane,
# gateway.backend.<INTERNAL_TLD>) — pointing the llm_gateway provider at it is
# exactly the bug this reconcile prevents. No PUBLIC_TLD (local stack) = no guard.
if [ "$FINAL_EXIT" = "0" ] && [ -n "${AISHA_LLM_GATEWAY_URL:-}" ]; then
  GW_EP="${AISHA_LLM_GATEWAY_URL%/}/v1"
  GW_HOST="${GW_EP#*://}"; GW_HOST="${GW_HOST%%[/:]*}"
  PUBLIC_ZONE="${PUBLIC_TLD:-//no-public-tld//}"
  GW_IS_PUBLIC=0
  case "$GW_HOST" in
    *.backend.*) ;;  # internal plane — even when INTERNAL_TLD sits under PUBLIC_TLD
    "$PUBLIC_ZONE"|*."$PUBLIC_ZONE") GW_IS_PUBLIC=1 ;;
  esac
  case "$GW_IS_PUBLIC" in
    1) log "WARN llm-gateway reconcile SKIPPED — AISHA_LLM_GATEWAY_URL looks like the public API gateway ($GW_EP)";;
    *) psql "$DB_URL" -v ON_ERROR_STOP=0 -c \
         "UPDATE public.ai_provider_registry SET endpoint_url = '$GW_EP', updated_at = now() WHERE slug = 'llm-gateway' AND endpoint_url IS DISTINCT FROM '$GW_EP';" \
         >>"$MIGRATE_OUT" 2>&1 && log "Reconciled llm-gateway endpoint -> $GW_EP";;
  esac
fi

# ── Lokální model (provider vllm-local) je ODVOZENÝ z topologie ──────────────
# ⛔ NAMĚŘENO 2026-09-13: seed zakládá vllm-local vypnutý s aliasem http://vllm:8000,
# který neexistuje, a nic ho nezapínalo — lokální model resolver nikdy nevybral.
# VLLM_GENERATION_URL vydává resolver topologie JEN pro provisionovaný svc-model
# (services.json model.provision_when_env: CHAT_GGUF_URL), takže je to jediná
# pravda: adresa je → povolen + endpoint; adresa není → vypnutý, HLASITĚ (NOTICE).
# Logika žije v jednom SQL souboru, který pouští i runtime test proti čisté DB.
# Proměnná jde přes psql -v (:'ep' = SQL literál), ne vlepením do řetězce příkazu.
# Selhání tady migrate NESHAZUJE (stejně jako reconcile výš): nenulový exit by přes
# `service_completed_successfully` nepustil gateway, tedy celé API, kvůli jednomu
# řádku providera.
#
# ⛔ NAMĚŘENO 2026-09-13: „nahlas se zaloguje" znamenalo `log "WARN … FAILED"` do
# logu, který nikdo nečte — exit se neměnil, cold-start se o selhání nedozvěděl.
# Doručuje se proto KANÁLEM, který cold-start z migrate UŽ ČTE: výstup
# v public.migration_log_dump, do něhož se na KONEC zapíše tail-stabilní ASCII
# verdikt (týž vzor jako PROVISION_GRANTED níž). Fáze G cold-startu ho z řádku
# TOHOTO běhu čte a selhání zapíše jako NEDOKONČENO s důvodem.
RECONCILE_VERDIKT=""
if [ "$FINAL_EXIT" = "0" ]; then
  RECONCILE_OUT=/tmp/reconcile-local-model.out
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -v ep="${VLLM_GENERATION_URL:-}" \
       -f scripts/deploy/reconcile-local-model-provider.sql >"$RECONCILE_OUT" 2>&1; then
    RECONCILE_VERDIKT="RECONCILE_VERDIKT slug=vllm-local status=ok"
    if [ -n "${VLLM_GENERATION_URL:-}" ]; then
      log "Reconciled vllm-local -> ${VLLM_GENERATION_URL} (enabled; models available after discovery)"
    else
      log "WARN vllm-local DISABLED — VLLM_GENERATION_URL not derived (svc-model not provisioned: CHAT_GGUF_URL empty)"
    fi
  else
    # Důvod = PRVNÍ chyba psql (první je příčina, zbytek následky — viz write_dump).
    # Do verdiktu jde jen tisknutelné ASCII bez uvozovek a zpětných lomítek: řádek
    # se čte z JSON odpovědi PostgRESTu, kde by je escapování rozlámalo.
    # (sed s rozsahem ` -~` pod LC_ALL=C, ne `tr [:print:]` — třídy znaků v tr BusyBoxu
    # jsou volba sestavení, rozsah v sed je POSIX.)
    _reconcile_duvod=$(grep -m1 -E "ERROR:|FATAL:" "$RECONCILE_OUT" 2>/dev/null | LC_ALL=C sed 's/[^ -~]//g; s/["\\]//g' | cut -c1-200)
    if [ -z "$_reconcile_duvod" ]; then
      _reconcile_duvod="psql skoncil nenulove a radek ERROR ve vystupu neni"
    fi
    RECONCILE_VERDIKT="RECONCILE_VERDIKT slug=vllm-local status=failed duvod=${_reconcile_duvod}"
    log "WARN vllm-local reconcile FAILED — provider state unchanged: ${_reconcile_duvod}"
  fi
  cat "$RECONCILE_OUT" >>"$MIGRATE_OUT" 2>/dev/null || true
  rm -f "$RECONCILE_OUT"
fi

# ── Implementation private hook (generic platform feature) ─────────────────
# After upstream migrations + platform seeds succeed, run the implementation
# private-data hook if AISHA_IMPLEMENTATION_HOOK or legacy AISHA_TENANT_HOOK
# points at an executable POSIX-sh script in the repo. This is the autonomous
# post-deploy entrypoint for fork/client implementations — runs in this
# `migrate` container (has psql + full repo + node).
#
# Examples:
#   AISHA_IMPLEMENTATION_HOOK=acme/deploy/migrate-hook.sh
#   AISHA_IMPLEMENTATION_HOOK=globex/deploy/migrate-hook.sh
#
# Skipped silently if no hook is set (upstream platform mode).
# Skipped with warning if file missing (non-fatal — env may be set ahead
# of code rollout). Hook failures DO mark migrate container as failed,
# so Coolify deploy reports red + we get observability via migration_log.
IMPLEMENTATION_HOOK="${AISHA_IMPLEMENTATION_HOOK:-${AISHA_TENANT_HOOK:-}}"
if [ "$FINAL_EXIT" = "0" ] && [ -n "$IMPLEMENTATION_HOOK" ]; then
  if [ -f "$IMPLEMENTATION_HOOK" ]; then
    log "Running implementation hook: $IMPLEMENTATION_HOOK"
    # Pass normalized DB URL so the hook never has to re-do quote stripping.
    AISHA_DB_URL="$DB_URL" sh "$IMPLEMENTATION_HOOK" >>"$MIGRATE_OUT" 2>&1
    HOOK_EXIT=$?
    log "Implementation hook exit=$HOOK_EXIT"
    if [ "$HOOK_EXIT" != "0" ]; then
      FINAL_EXIT="$HOOK_EXIT"
      STATUS=implementation_hook_failed
    fi
  else
    log "⚠ implementation hook $IMPLEMENTATION_HOOK set but file not found — skipping (non-fatal)"
  fi
fi

# ── Operator provisioning (de-hardcoded, dynamic sub resolution) ─────────────
# Resolve operator subs from the LIVE Keycloak by email and grant app roles.
# Runs AFTER the implementation hook on purpose: instance-data-hook.sh exports
# the private overlay's top-level operators.json (the production roster) to a
# stable scratch path, and we hand it to provision-operators.mjs as
# AISHA_OPERATORS_FILE — so a wipe cold-start restores operator users purely
# from the private instance repo, zero local files on the operator host.
# Roster priority inside provision-operators.mjs (file first since 2026-08-07 —
# a frozen AISHA_OPERATORS snapshot used to outrank the freshly re-cloned
# overlay, so roster changes never landed and this step still logged "ok"):
#   AISHA_OPERATORS_FILE > AISHA_OPERATORS env > config/operators.json >
#   AISHA_PRIMARY_ADMIN_EMAIL > realm-role fallback.
# With both present, the file wins and the difference is printed as a
# ROSTER CONFLICT block — grep the migrate log for it.
# Best-effort + soft-fail: runs only when SOME roster source is present AND
# Keycloak admin creds + URL are in scope; otherwise logs and skips (operators
# can be provisioned later by running scripts/db/provision-operators.mjs
# --apply from any host with Keycloak + DB access, or via
# scripts/instance-rollout.sh). Never fails the migrate container.
ROSTER_EXPORT="${AISHA_OPERATORS_EXPORT_FILE:-/tmp/aisha-instance-operators.json}"
if [ -z "${AISHA_OPERATORS_FILE:-}" ] && [ -f "$ROSTER_EXPORT" ]; then
  AISHA_OPERATORS_FILE="$ROSTER_EXPORT"
  log "operator roster: using overlay export $ROSTER_EXPORT (AISHA_OPERATORS_FILE)"
fi
# PLATFORM_ADMIN_EMAIL is a gate source too: it is the email the reachable
# render-realm __PLATFORM_ADMIN__ KC login is stamped with, and generate-secrets
# ALWAYS emits it (default admin@<PUBLIC_TLD>). Including it makes provision run on
# every stack so the in-script realm-role fallback (rosterFromRealm) authorizes the
# deliberate platform admin — with NO explicit roster, canCreate=false, so it only
# grants DB roles to KC users that already carry the realm admin/staff role and
# creates nobody (safe on pin-nothing forks). Without this the reachable admin is
# authenticated-but-unauthorized (verified tenant 2026-07-17).
if [ "$FINAL_EXIT" = "0" ] && { [ -n "${AISHA_OPERATORS:-}" ] || [ -n "${AISHA_OPERATORS_FILE:-}" ] || [ -n "${AISHA_PRIMARY_ADMIN_EMAIL:-}" ] || [ -n "${PLATFORM_ADMIN_EMAIL:-}" ]; }; then
  log "Provisioning operators (dynamic Keycloak sub resolution)"
  # Force the INTERNAL Keycloak alias for sub resolution: the core app's
  # injected KEYCLOAK_URL is the public https URL (cert signed by a public/LE
  # CA, not the internal PKI bundle this container trusts → TLS would fail).
  # <prefix>-keycloak je dosažitelný cross-stack přes sdílenou coolify síť.
  # On the first (pre-Keycloak) wave-2 run this still soft-fails; the cold-start
  # re-runs the migrate after Phase B imports the realm (see aisha-cold-start.sh).
  # Capture to a scratch file first: provision-operators may auto-create
  # missing Keycloak roster users (AISHA_OPERATORS_CREATE_MISSING, default on)
  # and print their ONE-TIME temp passwords as [TEMP-PASSWORD] lines. Those
  # lines are emitted to the container's REAL stdout only (docker logs /
  # Coolify app log) and STRIPPED from MIGRATE_OUT — its tail is persisted to
  # the anon-readable public.migration_log_dump and must never carry a secret.
  PROVISION_OUT=/tmp/provision-operators.out
  # Fold the platform admin (admin@<tld>) INTO an explicit roster. With an
  # overlay operators.json set (AISHA_OPERATORS_FILE), provision-operators runs
  # in roster mode and its realm-role FALLBACK — the only thing that grants the
  # synthetic platform admin its DB roles — is skipped, so admin@<tld> stays
  # authenticated-but-unauthorized unless it happens to be a human in the overlay
  # (adversarial verify 2026-07-19). Passing it as AISHA_PRIMARY_ADMIN_EMAIL makes
  # loadRoster unshift it with admin,staff. ONLY when a roster is already present:
  # roster-LESS installs keep it empty so the realm-role fallback still authorizes
  # every realm admin. generate-secrets emits PLATFORM_ADMIN_EMAIL, never
  # AISHA_PRIMARY_ADMIN_EMAIL, so this is the join point for the two.
  _provision_primary="${AISHA_PRIMARY_ADMIN_EMAIL:-}"
  if [ -z "$_provision_primary" ] && [ -n "${AISHA_OPERATORS_FILE:-}" ]; then
    _provision_primary="${PLATFORM_ADMIN_EMAIL:-}"
  fi
  if AISHA_DB_URL="${AISHA_DB_URL:-$DB_URL}" \
    AISHA_OPERATORS_FILE="${AISHA_OPERATORS_FILE:-}" \
    AISHA_PRIMARY_ADMIN_EMAIL="$_provision_primary" \
    KEYCLOAK_URL="${AISHA_PROVISION_KEYCLOAK_URL:-${KEYCLOAK_INTERNAL_URL:?provisioning operátorů volá Keycloak VNITŘNĚ — bez KEYCLOAK_INTERNAL_URL by šel na jméno CIZÍ instance}}" \
    node scripts/db/provision-operators.mjs --apply >"$PROVISION_OUT" 2>&1; then
    log "operator provisioning ok"
    _provision_ok=1
  else
    _provision_ok=0
    # Carry the CAUSE into the WARN itself: the full output lands in
    # migration_log_dump, but the one line an operator actually reads is this
    # one — "skipped/failed" with no reason hid a dead aisha-keycloak alias
    # ('fetch failed') behind a cold-start that then reported success
    # (tenant 2026-07-18: admin silently unauthorized after every wipe).
    log "WARN operator provisioning skipped/failed (non-fatal): $(tail -c 300 "$PROVISION_OUT" 2>/dev/null | tr '\n' ' ' | tail -c 200) — run provision-operators.mjs --apply later"
  fi
  grep '^\[TEMP-PASSWORD\]' "$PROVISION_OUT" 2>/dev/null || true
  grep -v '^\[TEMP-PASSWORD\]' "$PROVISION_OUT" >>"$MIGRATE_OUT" 2>/dev/null || true
  # Tail-stable, plain-ASCII grant verdict — emitted ONLY when provisioning
  # EXITED 0. provision-operators prints its '✓ <email> → <sub>… roles=[<roles>]'
  # lines during RESOLUTION, BEFORE the single ON_ERROR_STOP=1 BEGIN…COMMIT that
  # writes public.user_roles (execFileSync psql :461 throws → exit 1 on any grant
  # error → whole txn rolls back). Exit 0 therefore means resolved AND committed;
  # re-emitting these lines UNCONDITIONALLY let a rolled-back COMMIT still print
  # PROVISION_GRANTED and false-PASS the cold-start truth-check (adversarial
  # verify 2026-07-19). Gate on success; place at the log END so it survives
  # write_dump's `tail -c 30000` and lands in the JSON dump as a clean ASCII
  # substring (no ✓/→/unicode). The cold-start check keys on the SPECIFIC admin.
  if [ "${_provision_ok:-0}" = "1" ]; then
    grep ' roles=\[' "$PROVISION_OUT" 2>/dev/null | while IFS= read -r _grant; do
      _ge=$(printf '%s' "$_grant" | sed -nE 's/.*[[:space:]]([^[:space:]]+@[^[:space:]]+)[[:space:]].*roles=\[([^]]*)\].*/\1/p')
      _gr=$(printf '%s' "$_grant" | sed -nE 's/.*roles=\[([^]]*)\].*/\1/p')
      # Otisk místo adresy: řádek končí ve veřejně čitelném migration_log_dump. Cold-start
      # spočítá týž otisk (malá písmena, sha256) z adresy, kterou sám deklaroval.
      _gh=$(printf '%s' "$_ge" | tr '[:upper:]' '[:lower:]' | sha256sum | cut -d' ' -f1)
      [ -n "$_ge" ] && [ -n "$_gh" ] && log "PROVISION_GRANTED email_sha256=${_gh} roles=${_gr}"
    done
  fi
  rm -f "$PROVISION_OUT"
else
  log "operator provisioning: no roster source (AISHA_OPERATORS / AISHA_OPERATORS_FILE / overlay operators.json / AISHA_PRIMARY_ADMIN_EMAIL / PLATFORM_ADMIN_EMAIL) — skipping (provision later)"
fi

# ── aisha-pki-issuer (IN-CLUSTER) — break the PKI-issuer chicken-and-egg ───────
# The renewer needs the aisha-pki-issuer KC client to mint any mesh cert, but the
# operator-side bootstrap cannot create it in the cert-less first-boot window: the
# https DIRECT KC face serves Traefik's self-signed default cert and bootstrap's
# `curl -fsS` (no -k, by design) refuses it — and that very cert is what the issuer
# unlocks. So create the client HERE, in-cluster, over ${KEYCLOAK_INTERNAL_URL}
# with the PRE-GENERATED secret (matches the renewer's immutable env) — a
# locked-down operator with only Coolify-API access never needs a KC tunnel.
# Runs after the realm exists (FINAL_EXIT=0 = migrate ran; the cold-start re-runs
# the migrate after Phase B imports the realm). Non-fatal: the renewer short-polls.
if [ "$FINAL_EXIT" = "0" ] && [ -n "${KEYCLOAK_ADMIN_PASSWORD:-}" ]; then
  log "Provisioning aisha-pki-issuer KC client (in-cluster, ${KEYCLOAK_INTERNAL_URL}, --issuer-only)"
  ISSUER_OUT=/tmp/pki-issuer.out
  if KEYCLOAK_URL="${AISHA_PROVISION_KEYCLOAK_URL:-${KEYCLOAK_INTERNAL_URL:?vydavatelský klient se zakládá VNITŘNĚ — bez KEYCLOAK_INTERNAL_URL by šel na Keycloak CIZÍ instance}}" \
    bash scripts/aisha-bootstrap-user-init.sh --issuer-only >"$ISSUER_OUT" 2>&1; then
    log "aisha-pki-issuer provisioning ok"
  else
    log "WARN aisha-pki-issuer provisioning failed (non-fatal — renewer retries): $(tail -c 220 "$ISSUER_OUT" 2>/dev/null | tr '\n' ' ' | tail -c 180)"
  fi
  grep -v '^\[TEMP-PASSWORD\]' "$ISSUER_OUT" >>"$MIGRATE_OUT" 2>/dev/null || true
  rm -f "$ISSUER_OUT"
fi

# Verdikt reconcile až TADY, těsně před zápisem: write_dump ukládá jen posledních
# 400 řádků výstupu a hook instančních dat i provisioning operátorů mezi reconcile
# a tímhle místem vypisují dost na to, aby dřívější řádek vytlačily.
if [ -n "$RECONCILE_VERDIKT" ]; then
  log "$RECONCILE_VERDIKT"
fi
write_dump "$STATUS" "$FINAL_EXIT"
log "=== DONE status=$STATUS exit=$FINAL_EXIT ==="

# Sentinel row inserted AFTER write_dump to confirm entrypoint completed
# normally. If write_dump's SQL file ever fails (auth race, malformed escape,
# duplicate constraint, etc.), THIS minimal sentinel still gets logged so
# we can distinguish "entrypoint ran end-to-end but write_dump SQL was
# rejected" from "entrypoint died before reaching write_dump".
# ⛔ NAMĚŘENO 2026-09-07: sentinel zapisoval SYROVÝ $STATUS (např.
# `implementation_hook_failed`), jenže CHECK na sloupci povoluje jen
# `running|ok|error` (infra/postgres/000_init_roles_schemas.sql). Poslední pojistka
# — ta, co má zafungovat, když všechno ostatní selže — tedy sama padala:
#     ERROR: new row ... violates check constraint "migration_log_status_check"
# A protože se chyba vybírala jako POSLEDNÍ (`tail -1`), stal se z jejího pádu
# zaznamenaný "důvod" pádu migrace. Skutečný stav zůstává v textu zprávy, do
# sloupce jde kanonická hodnota — táž, jakou používá write_dump.
SENTINEL_STATUS="$STATUS"
if [ "$SENTINEL_STATUS" != "ok" ] && [ "$SENTINEL_STATUS" != "running" ]; then
  SENTINEL_STATUS="error"
fi
SENTINEL_SQL=/tmp/migrate-sentinel-$$.sql
{
  printf 'CREATE SCHEMA IF NOT EXISTS aisha_meta;\n'
  printf 'CREATE TABLE IF NOT EXISTS aisha_meta.migration_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, status text, exit_code int, applied_migrations text[], error_message text, env_info jsonb);\n'
  # Viz poznámka u prvního výskytu: schéma se sladí se zapisovanými stavy.
  printf 'ALTER TABLE aisha_meta.migration_log DROP CONSTRAINT IF EXISTS migration_log_status_check;\n'
  printf 'ALTER TABLE aisha_meta.migration_log ADD CONSTRAINT migration_log_status_check CHECK (status IN (%s));\n' \
    "'running', 'ok', 'error', 'seed_failed', 'implementation_hook_failed'"
  printf 'GRANT USAGE ON SCHEMA aisha_meta TO service_role, authenticated, authenticator;\n'
  printf 'GRANT SELECT ON aisha_meta.migration_log TO authenticated, authenticator, service_role;\n'
  printf "INSERT INTO aisha_meta.migration_log (finished_at, status, exit_code, error_message) VALUES (now(), '%s', %s, 'entrypoint sentinel — reached after write_dump (write_dump status=%s exit=%s)');\n" "$SENTINEL_STATUS" "$FINAL_EXIT" "$STATUS" "$FINAL_EXIT"
} > "$SENTINEL_SQL"
psql "$DB_URL" -v ON_ERROR_STOP=0 -f "$SENTINEL_SQL" >>"$MIGRATE_OUT" 2>&1 || true
rm -f "$SENTINEL_SQL"

# Extra visibility: tee tail to stderr (captured by docker logs)
tail -c 8000 "$MIGRATE_OUT" 1>&2

if [ "${AISHA_MIGRATE_DEBUG_HOLD:-0}" = "1" ]; then
  log "DEBUG_HOLD=1 → exit 0 regardless of status (dependents will start)"
  exit 0
fi
exit "$FINAL_EXIT"
