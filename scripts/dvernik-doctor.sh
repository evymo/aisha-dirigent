#!/usr/bin/env bash
# =============================================================================
# dvernik-doctor.sh — ověří CELÝ řetěz dveří v PRODUKCI, pokusem
# =============================================================================
# ⭐ POKUS, NE DOTAZ. Dveře záměrně mlčí: kdo nemá přístup, nemá se dozvědět,
# že tam něco je. Cena je, že zavřené dveře jsou k NEROZEZNÁNÍ od mrtvé sítě —
# obojí je ticho. Jediné použitelné měřidlo je proto ROZDÍL PŘED A PO ZAŤUKÁNÍ,
# ne odpověď serveru.
#
# ⛔ SONDA MUSÍ UMĚT ODPOVĚDĚT „NE". Každý krok níž má tvar, ve kterém se dá
# selhat — a když se nedá měřit, řekne to nahlas místo tichého průchodu.
#
# Co ověřuje (v pořadí, v jakém se to může rozbít):
#   1. svc-knock běží a poslouchá na UDP portu
#   2. zaťukání z internetu DORAZÍ            (rozdíl v logu: OPEN)
#   3. otevření se ZAPÍŠE do mapy             (Redis DB dle SPA_REDIS_DB)
#   4. gateway čte TUTÉŽ mapu a zná režim     (jinak by v `enforce` zamkl všechny)
#
# Použití:
#   scripts/dvernik-doctor.sh --host <ssh-host> --edge <verejna-ip-nebo-fqdn>
#
# Kroky 2–3 vyžadují pověření pro klepání (`SPA_OPERATORS_B64`). Bez nich
# skript kroky PŘESKOČÍ a řekne to — neprohlédnuto není totéž co v pořádku.
set -uo pipefail

# Port je vlastnost instance (env-doctor: `SPA_KNOCK_PUBLIC_PORT`, static 18181).
# Tady stojí jako literál skriptu, ne jako dosazení za chybějící env — doktor
# nesmí hádat, co neměřil.
SSH_HOST=""; EDGE=""; PORT=18181
while [ $# -gt 0 ]; do
  case "$1" in
    --host) SSH_HOST="$2"; shift 2 ;;
    --edge) EDGE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "neznámý přepínač: $1" >&2; exit 2 ;;
  esac
done
[ -z "$SSH_HOST" ] && { echo "⛔ chybí --host (ssh cíl, kde běží kontejnery)" >&2; exit 2; }

VYSLEDEK=0

# ⛔ `DB` se plnilo AŽ uvnitř kroku klepání. Bez pověření se ten krok přeskočí,
# proměnná nevznikne a `set -u` skript ZABIJE na řádku, kde se čte — doktor
# tedy umřel právě v situaci, kvůli které existuje (nemám pověření, chci vidět
# aspoň zbytek). Prázdno NENÍ hodnota: níž se hlásí jako NEDORUČENO.
DB=""
ok(){ echo "✓ $1"; }
ne(){ echo "⛔ $1"; VYSLEDEK=1; }
skip(){ echo "∅ NEPROHLÉDNUTO: $1"; }

# ⛔ MESH SIDECARY SE VYLUČUJÍ. Ke každé službě běží druhý kontejner
# `<jméno>-mesh-*`, který se jmenuje skoro stejně, ale nemá v sobě NIC z appky.
# `head -1` po něm sáhne stejně ochotně a výsledek pak vypadá jako porucha
# služby — naměřeno dvakrát tentýž den (broker, pak Redis: `redis-cli not found`
# a z toho falešné „otevření se nezapsalo").
kont(){ ssh -o ConnectTimeout=15 "$SSH_HOST" "docker ps --format '{{.Names}}' | grep -E '$1' | grep -v -- '-mesh-' | head -1" 2>/dev/null | tr -d '\r'; }

# ── 1. listener ──────────────────────────────────────────────────────────────
KNOCK=$(kont '^svc-knock')
if [ -z "$KNOCK" ]; then
  ne "svc-knock NEBĚŽÍ — dveře nemá kdo otevřít"
else
  ok "svc-knock běží ($KNOCK)"
  if ssh -o ConnectTimeout=15 "$SSH_HOST" "ss -lun 2>/dev/null | grep -q ':$PORT '" 2>/dev/null; then
    ok "hostitel poslouchá na $PORT/UDP"
  else
    ne "na $PORT/UDP nikdo neposlouchá — datagram nemá kam dorazit"
  fi
fi

# ── 2.+3. zaťukání a zápis ───────────────────────────────────────────────────
if [ -z "${SPA_OPERATORS_B64:-}" ] || [ -z "$EDGE" ]; then
  skip "klepnutí (chybí SPA_OPERATORS_B64 nebo --edge) — průchodnost cesty NEMĚŘENA"
else
  PRED=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker logs --since 5m $KNOCK 2>&1 | grep -c '\"ev\":\"OPEN\"'" 2>/dev/null | tr -d '\r ')
  node "$(dirname "$0")/knock.mjs" --host "$EDGE" --port "$PORT" --scope ops >/dev/null 2>&1 \
    || ne "klepnutí se nepodařilo odeslat"
  sleep 4
  PO=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker logs --since 5m $KNOCK 2>&1 | grep -c '\"ev\":\"OPEN\"'" 2>/dev/null | tr -d '\r ')
  # Nespočítané NENÍ nula: prázdno znamená, že se log nedal přečíst.
  if [ -z "${PRED:-}" ] || [ -z "${PO:-}" ]; then
    skip "průchodnost zaťukání — log svc-knock se nedal přečíst"
  elif [ "$PO" -gt "$PRED" ] 2>/dev/null; then
    # ⛔ Dřív tu stálo „DORAZILO z $EDGE". `$EDGE` je ale CÍL z příkazové řádky,
    # ne změřený původ — doktor tak vydával vlastní argument za nález. Měřeno
    # je JEN to, že počet OPEN vzrostl; odkud, ví až mapa (krok níž).
    ok "zaťukání DORAZILO (OPEN: $PRED → $PO; cíl klepání: $EDGE)"
  else
    ne "zaťukání NEDORAZILO (OPEN: $PRED → $PO) — cesta z internetu je přerušená"
  fi

  # zápis do mapy: čte se TÁŽ DB, jakou má svc-knock
  DB=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker exec $KNOCK sh -c 'echo \$SPA_REDIS_DB'" 2>/dev/null | tr -d '\r ')
  REDIS=$(kont '^shared-redis-[a-z0-9]')
  MOJE_IP=$(curl -sS --max-time 10 https://api.ipify.org 2>/dev/null)
  if [ -z "$REDIS" ] || [ -z "$MOJE_IP" ]; then
    skip "mapa otevřených adres (Redis nenalezen nebo neznám svou IP)"
  else
    PW=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker exec $KNOCK sh -c 'echo \$AISHA_SHARED_REDIS_URL'" 2>/dev/null | sed -E 's#.*//[^:]*:([^@]*)@.*#\1#' | tr -d '\r')
    TTL=$(ssh -o ConnectTimeout=20 "$SSH_HOST" "docker exec $REDIS redis-cli --user core --pass '$PW' --no-auth-warning -n $DB TTL 'knock:ip:$MOJE_IP'" 2>/dev/null | tr -d '\r ')
    # ⛔ Prázdná odpověď NENÍ „nezapsáno" — je to „nezměřeno". Splynutí obojího
    # udělá z vady sondy hlášení o vadě systému (přesně to se stalo napoprvé).
    if [ -z "${TTL:-}" ]; then
      skip "mapa otevřených adres — dotaz do Redisu neodpověděl (ověř pověření a kontejner)"
    elif [ "$TTL" -gt 0 ] 2>/dev/null; then
      ok "otevření ZAPSÁNO do mapy (DB $DB, knock:ip:$MOJE_IP, zbývá ${TTL}s)"
    elif [ "$TTL" = "-2" ]; then
      ne "otevření se do mapy NEZAPSALO (DB $DB) — gateway se o něm nedozví"
    else
      ne "klíč v mapě je, ale bez trvání (TTL=$TTL) — otvor se nezavře sám"
    fi
  fi
fi

# ── 4. gateway čte tutéž mapu ────────────────────────────────────────────────
GW=$(kont 'gateway')
if [ -z "$GW" ]; then
  ne "gateway NEBĚŽÍ"
else
  MODE=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker exec $GW sh -c 'echo \$SPA_DOOR_MODE'" 2>/dev/null | tr -d '\r ')
  GDB=$(ssh -o ConnectTimeout=15 "$SSH_HOST" "docker exec $GW sh -c 'echo \$SPA_REDIS_DB'" 2>/dev/null | tr -d '\r ')
  # Porovnává se ÚČINNÁ hodnota, ne řetězec. Nenastavená proměnná znamená
  # kódový default (4 na obou stranách) — a ten se shoduje. Srovnávat „prázdno"
  # s „4" by hlásilo rozpor tam, kde žádný není (naměřeno na první verzi sondy).
  # Že je hodnota jen kódová, a ne doručená, se ale říká NAHLAS: přežije to
  # každý deploy jen do chvíle, než se default v kódu změní.
  KODOVY_DEFAULT_DB=4
  DB_UCINNE="$DB";   [ -z "$DB_UCINNE" ]  && DB_UCINNE="$KODOVY_DEFAULT_DB"
  GDB_UCINNE="$GDB"; [ -z "$GDB_UCINNE" ] && GDB_UCINNE="$KODOVY_DEFAULT_DB"
  [ -z "$DB" ] || [ -z "$GDB" ] && echo "ℹ️  DB mapy není DORUČENÁ, drží ji kódový default ($KODOVY_DEFAULT_DB) — shoda je náhoda dvou defaultů, ne kontrakt"
  # ⛔ Dřív tu stálo `[ -z "$MODE" ] && MODE="off"`. Nepřečtený režim NENÍ „off":
  # doktor tím tvrdil o produkci něco, co neměřil — a zrovna u dveří je rozdíl
  # mezi „nezavírá se nic" a „nevím" ten podstatný. Prázdno se nese dál a hlásí
  # se jako NEZMĚŘENO.
  DB="$DB_UCINNE"; GDB="$GDB_UCINNE"; KDB="$DB_UCINNE"
  if [ "$GDB" = "$KDB" ]; then
    ok "gateway čte TUTÉŽ mapu jako svc-knock (DB $GDB)"
  else
    ne "ROZPOR MAP: gateway DB=$GDB, svc-knock DB=$KDB — v 'enforce' by zamkl VŠECHNY"
  fi
  case "$MODE" in
    off)     echo "ℹ️  režim: off — zavřeno NENÍ NIC (dveřník jen existuje)" ;;
    measure) echo "ℹ️  režim: measure — odmítnutí se ZAPISUJE, ale nikdo se neodmítá" ;;
    enforce) echo "ℹ️  režim: enforce — ZAMČENO" ;;
    '')      skip "režim dveří se nepodařilo přečíst — NEZMĚŘENO není 'off'" ;;
    *)       ne "neznámý režim '$MODE' — očekáváno off|measure|enforce" ;;
  esac
fi

# ── 5. kterou hlavičkou přichází klientská adresa ────────────────────────────
#
# ⛔ 2026-08-31: `measure` hlásil `ip:null` a nic víc, takže se třikrát po sobě
# HÁDALO, který parametr adresu nese. Jméno té hlavičky v repu NENÍ — vzniká
# na pfSense/HAProxy a nikdy jsme ho nepsali. Nedá se vyčíst, jen změřit.
#
# Tenhle krok pošle požadavek VEŘEJNOU cestou a přečte, co u brány přistálo.
# Vyžaduje `measure` (v `enforce` se vstup nepřikládá) a gateway s `vstup`.
echo
echo "── 5. kterou hlavičkou přichází klientská adresa ──"
GW=$(kont '^gateway-')
# Veřejná adresa se NEZADÁVÁ: čte se z NASAZENÉHO cíle, ať doktor neměří jiný
# svět než ten, který popisuje. Ruční hodnota by byla domněnka o produkci.
API_HOST=""
[ -n "$GW" ] && API_HOST=$(ssh -o ConnectTimeout=20 "$SSH_HOST" \
  "docker inspect $GW --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^API_DOMAIN_PUBLIC=' | cut -d= -f2-" 2>/dev/null | tr -d '\r ')
API_URL=""; [ -n "$API_HOST" ] && API_URL="https://$API_HOST"
# Režim se ČTE ZNOVU z cíle, ne přebírá z kroku 4: krok, který závisí na tom,
# že proběhl jiný krok, měří jeho stav, ne svět.
REZIM=""
[ -n "$GW" ] && REZIM=$(ssh -o ConnectTimeout=20 "$SSH_HOST" \
  "docker exec $GW sh -c 'echo \$SPA_DOOR_MODE'" 2>/dev/null | tr -d '\r ')
if [ -z "$GW" ]; then
  skip "vstup dveří — gateway nenalezena"
elif [ -z "$REZIM" ]; then
  skip "vstup dveří — režim se nepodařilo přečíst (nezměřeno není 'off')"
elif [ "$REZIM" != "measure" ]; then
  skip "vstup dveří — režim je '$REZIM', vstup se přikládá jen v 'measure'"
elif [ -z "$API_URL" ]; then
  skip "vstup dveří — v bráně není API_DOMAIN_PUBLIC, nevím kam poslat pokus"
else
  ZNACKA="doctor-$$"
  curl -sS -o /dev/null --max-time 20 "$API_URL/rest/v1/?$ZNACKA=1" 2>/dev/null || true
  sleep 3
  VSTUP=$(ssh -o ConnectTimeout=20 "$SSH_HOST" \
    "docker logs --since 2m $GW 2>&1 | grep -F '$ZNACKA' | grep -o '\"vstup\":{[^}]*}' | tail -1" 2>/dev/null | tr -d '\r')
  MOJE=$(curl -sS --max-time 10 https://api.ipify.org 2>/dev/null)
  if [ -z "$VSTUP" ]; then
    # Nenalezeno NENÍ „nedorazilo" — může to být starý obraz brány bez `vstup`.
    ne "vstup dveří se nepodařilo přečíst — brána možná běží BEZ pole 'vstup' (starý obraz)"
  else
    echo "   naměřeno: $VSTUP"
    if [ -n "$MOJE" ] && printf '%s' "$VSTUP" | grep -qF "$MOJE"; then
      ok "klientská adresa ($MOJE) k bráně DORAZILA — je v hlavičce výš"
    elif [ -n "$MOJE" ]; then
      ne "klientská adresa ($MOJE) v žádné hlavičce NENÍ — 'enforce' by zamkl i nás"
    else
      skip "svou veřejnou adresu neznám (ipify neodpověděl) — nelze porovnat"
    fi
  fi
fi

echo
[ "$VYSLEDEK" -eq 0 ] && echo "VŠE OVĚŘENO" || echo "SELHALO — viz ⛔ výš"
exit "$VYSLEDEK"
