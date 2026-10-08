#!/bin/sh
# =============================================================================
# hostfw.sh — hostitelský firewall uzlu `gpu` (GPU) jako kód.
# =============================================================================
# Běží v kontejneru `accel-hostfw` (network_mode: host, cap NET_ADMIN+NET_RAW).
# Výklad pravidla a důvody: docs/compose-notes/docker-compose.coolify-accel-hostfw.yml.md
#
# Co dělá:
#   • Vlastní řetězce AISHA-HOSTFW-IN (INPUT veřejného rozhraní) a AISHA-HOSTFW-FWD
#     (provoz z veřejného rozhraní do DOCKEROVÝCH mostů). Do DOCKER-USER jde jen
#     skok na AISHA-HOSTFW-FWD podmíněný dockerovým mostem (-o docker0, -o br-+);
#     forward do jiných mostů (např. most CI VM) nikdy nevidí.
#   • NIKDY neflushuje cizí řetězce: iptables-restore --noflush deklaruje jen
#     vlastní řetězce; skok z INPUT se vkládá až do naplněného řetězce.
#   • Pořadí v INPUT: lo → ESTABLISHED,RELATED → nutné ICMP (PMTU) → SSH 22 ze
#     správcovských adres → SSH 22 komukoli (JEN s ACCEL_FW_SSH=svet) → cokoli ze
#     správcovských adres → UDP port meshe (JEN s deklarací ACCEL_FW_UDP_MESH_PORT)
#     → teprve zbytek (measure: jen
#     čítač, enforce: DROP). SSH ze správy stojí PŘED „cokoli ze správy": jeho
#     čítač potvrzuje enforce (nové SSH spojení ze správy).
#   • Pořadí v DOCKER-USER (publikované porty kontejnerů — Docker je DNATuje mimo
#     INPUT): ESTABLISHED,RELATED → ICMP → cokoli ze správcovských adres → UDP meshe
#     (jen s deklarací) → zbytek. Nejmenší oprávnění: modelový mesh v1 (varianta C)
#     jede jen přes relay na TCP 443 a příchozí UDP na uzlu nic neobsluhuje — bez
#     ACCEL_FW_UDP_MESH_PORT žádné UDP pravidlo (dřív NETBIRD_MESH_PORT vždy).
#     „Světu" tu neplatí nikdy: SSH světu je SSH HOSTITELE, ne port kontejneru.
#   • Vlastník uzlu: pravidla jsou stav CELÉHO stroje (řetězce AISHA-HOSTFW-*).
#     Firewall naběhne jen tehdy, když ACCEL_OWNER_PREFIX instance je deklarovaný
#     vlastník uzlu (ACCEL_FW_NODE_OWNER — deklarace uzlu, výklad accel-deklarace.mjs
#     --vlastnik). Jinak STOP (SELHALO) s pojmenovanou příčinou a ŽÁDNÉ volání
#     iptables — ani sundání „svých" pravidel: na cizím uzlu patří vlastníkovi.
#     Ptá se dřív než cokoli jiného, i v --plan a --vrat.
#   • Vlastník i NA UZLU: obě strany té otázky výš jsou z deklarace TÉHOŽ forku —
#     dva forky, které se oba deklarují jako vlastník, by ji prošly oba. Identita
#     vlastníka se proto zapisuje do komentáře prvního pravidla vlastních řetězců
#     (ZNACKA_VLASTNIK = aisha-hostfw:vlastnik:<identita>) a před KAŽDÝM zápisem se
#     čte z existujících řetězců AISHA-HOSTFW-*: jiný vlastník, nebo řetězce bez
#     identity = STOP (SELHALO) a žádná změna pravidel; vlastní = pokračuje
#     (idempotentně). Re-recenze 2 d8, F2.
#   • Odchozí provoz NEOMEZUJE: do OUTPUT nesahá a skok z DOCKER-USER míří jen
#     z veřejného rozhraní DO dockerových mostů. Agenti NetBird (443/tcp a 3478/udp
#     na edge forků, UDP WireGuard) projdou; jejich odpovědi pouští ESTABLISHED.
#   • Dvojče pro ip6tables (i když dnes není veřejná IPv6).
#   • Backend: TENTÝŽ, ve kterém drží Docker řetěz DOCKER-USER (nf_tables / legacy);
#     `iptables -V` zvoleného binárního souboru musí backend potvrdit, jinak NIC.
#   • enforce: auto-návrat — bez nárůstu čítače pravidla SSH ze správy do
#     ACCEL_FW_CONFIRM_S sundá JEN svoje skoky a řetězce (stav VRACENO, unhealthy).
#   • Smyčka každých ACCEL_FW_INTERVAL_S ověřuje svá pravidla (-C) a doplní je.
#
# Vstupy (prostředí; hodnoty jsou DATA INSTANCE, skript žádnou nedosazuje):
#   ACCEL_FW_MODE, ACCEL_FW_SSH, ACCEL_FW_ADMIN_CIDRS, ACCEL_FW_UDP_MESH_PORT
#                                        — výklad: scripts/lib/accel-deklarace.mjs --firewall
#                                          (UDP port meshe volitelný: prázdno = zavřeno)
#   ACCEL_OWNER_PREFIX, ACCEL_FW_NODE_OWNER — kdo je instance a kdo vlastník uzlu (--vlastnik)
#   ACCEL_FW_CONFIRM_S, ACCEL_FW_INTERVAL_S — okno potvrzení / perioda smyčky (sekundy)
#   DRY_RUN                              — 1 = jen vypíše plán, nesahá na nic; 0 nebo
#                                          nenastaveno = ostrý běh; cokoli jiného je
#                                          neznámý přepínač → firewall NENABĚHNE
#   HOSTFW_STAV_DIR, HOSTFW_PROC_NET, HOSTFW_KROK_S — kde skript v kontejneru žije
#     (adresář stavu, /proc/net, krok čekání na potvrzení). Deklaruje je OBRAZ
#     (ENV v Dockerfile.accel-hostfw); skript je nedosazuje — bez nich skončí hned.
#
# Použití:
#   hostfw.sh            — nasadit a držet (PID 1 pod tini)
#   hostfw.sh --plan     — vypsat plán (DRY_RUN) a skončit; kód 0 = platná deklarace
#   hostfw.sh --zdravi   — healthcheck: 0 jen ve stavu MERENI/VYNUCENO s pravidly na místě
#   hostfw.sh --vrat     — sundat VLASTNÍ skoky a řetězce (nouzově, ručně)
# =============================================================================
set -u

KOREN="$(cd "$(dirname "$0")/../.." && pwd)"
DEKLARACE="$KOREN/scripts/lib/accel-deklarace.mjs"
STAV_DIR="${HOSTFW_STAV_DIR:?adresář stavu deklaruje obraz (ENV v Dockerfile.accel-hostfw) — skript ho nedosazuje}"
PROC_NET="${HOSTFW_PROC_NET:?cestu k /proc/net deklaruje obraz (ENV v Dockerfile.accel-hostfw) — skript ji nedosazuje}"
KROK_S="${HOSTFW_KROK_S:?krok čekání na potvrzení deklaruje obraz (ENV v Dockerfile.accel-hostfw) — skript ho nedosazuje}"
# Přepínače běhu z argumentů (--plan, --vrat) — výchozí stav je výslovný, ne dosazený při čtení.
PLAN_JEN=0
VRAT=0
# Komu je otevřené SSH hostitele (svet|sprava) — jen z výkladu deklarace (nacti_deklaraci).
SSH_KOMU=""
# Příchozí UDP port meshe (z výkladu deklarace); prázdný = žádné UDP pravidlo.
UDP_MESH=""
# Identita vlastníka uzlu (z --vlastnik) a značka, kterou nese na uzlu (F2).
VLASTNIK_UZLU=""
ZNACKA_VLASTNIK=""

RETEZ_IN="AISHA-HOSTFW-IN"
RETEZ_FWD="AISHA-HOSTFW-FWD"
ZNACKA="aisha-hostfw"
ZNACKA_SPRAVA="aisha-hostfw:sprava"
# Pozor na jména: čítač potvrzení hledá ZNACKA_SPRAVA podřetězcem — další značky ji
# nesmí obsahovat (proto „ze-spravy", ne „sprava-vse").
ZNACKA_SSH_SVET="aisha-hostfw:ssh-svet"
ZNACKA_ZE_SPRAVY="aisha-hostfw:ze-spravy"
ZNACKA_POTVRZENO="aisha-hostfw:potvrzeno"
DOCKER_MOSTY="docker0 br-+"

log() { printf '[hostfw] %s\n' "$*"; }
chyba() { printf '[hostfw] CHYBA: %s\n' "$*" >&2; }

# ── Stav (tmpfs) — čte ho healthcheck ────────────────────────────────────────
zapis_stav() {  # $1 = stav, $2 = důvod
  [ "$PLAN_JEN" = 1 ] && return 0
  mkdir -p "$STAV_DIR" 2>/dev/null || return 0
  printf 'stav=%s\nbackend=%s\nrozhrani=%s\nduvod=%s\n' \
    "$1" "${BACKEND:-}" "${ROZHRANI:-}" "${2:-}" > "$STAV_DIR/stav.tmp" \
    && mv "$STAV_DIR/stav.tmp" "$STAV_DIR/stav"
  log "stav: $1${2:+ — $2}"
}

cti_stav() {  # $1 = klíč
  [ -r "$STAV_DIR/stav" ] || return 1
  sed -n "s/^$1=//p" "$STAV_DIR/stav" | head -1
}

# ── Deklarace (jeden výklad: accel-deklarace.mjs) ────────────────────────────
nacti_deklaraci() {
  if ! vystup="$(node "$DEKLARACE" --firewall)"; then
    return 1
  fi
  REZIM="$(printf '%s\n' "$vystup" | sed -n 's/^rezim=//p')"
  SSH_KOMU="$(printf '%s\n' "$vystup" | sed -n 's/^ssh=//p')"
  # Řádek udp_mesh= výklad vydává VŽDY (prázdná hodnota = zavřeno); chybí-li, výklad je jiný, než čekám.
  if ! printf '%s\n' "$vystup" | grep -q '^udp_mesh='; then
    chyba "výklad deklarace nevydal řádek udp_mesh= — nenabíhám"; return 1
  fi
  UDP_MESH="$(printf '%s\n' "$vystup" | sed -n 's/^udp_mesh=//p' | head -1)"
  case "$UDP_MESH" in
    '') ;;
    *[!0-9]*) chyba "výklad deklarace vydal UDP port meshe '$UDP_MESH' — nenabíhám"; return 1 ;;
  esac
  CIDR4="$(printf '%s\n' "$vystup" | sed -n 's/^cidr4=//p')"
  CIDR6="$(printf '%s\n' "$vystup" | sed -n 's/^cidr6=//p')"
  case "$REZIM" in
    measure|enforce) ;;
    *) chyba "výklad deklarace nevydal režim — nenabíhám"; return 1 ;;
  esac
  # Komu je otevřené SSH: jen to, co výklad deklarace vydal — žádná výchozí volba.
  case "$SSH_KOMU" in
    svet|sprava) return 0 ;;
    *) chyba "výklad deklarace nevydal volbu SSH (svet|sprava) — nenabíhám"; return 1 ;;
  esac
}

over_cislo() {  # $1 = jméno, $2 = hodnota, $3 = min, $4 = max
  case "$2" in
    ''|*[!0-9]*) chyba "$1='$2' není celé číslo"; return 1 ;;
  esac
  if [ "$2" -lt "$3" ] || [ "$2" -gt "$4" ]; then
    chyba "$1=$2 mimo rozsah $3–$4"; return 1
  fi
}

# ── Veřejné rozhraní = rozhraní výchozí trasy ────────────────────────────────
zjisti_rozhrani() {
  r4="$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1)}}' | sort -u)"
  pocet="$(printf '%s\n' "$r4" | grep -c .)"
  if [ "$pocet" -ne 1 ]; then
    chyba "výchozí trasa IPv4 vede přes ${pocet} rozhraní ('$(printf '%s' "$r4" | tr '\n' ' ')') — veřejné rozhraní neurčím"
    return 1
  fi
  r6="$(ip -6 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1)}}' | sort -u)"
  for d in $r6; do
    if [ "$d" != "$r4" ]; then
      chyba "výchozí trasa IPv6 vede přes '$d', IPv4 přes '$r4' — dvě veřejná rozhraní neumím"
      return 1
    fi
  done
  case "$r4" in
    *[!A-Za-z0-9_.-]*|'') chyba "jméno rozhraní '$r4' nevypadá jako rozhraní"; return 1 ;;
  esac
  ROZHRANI="$r4"
}

# ── Backend: kde drží Docker DOCKER-USER ─────────────────────────────────────
zjisti_backend() {
  nft=0; leg=0
  iptables-nft -w -n -L DOCKER-USER >/dev/null 2>&1 && nft=1
  # Legacy se nepouští naslepo: první volání iptables-legacy by na nft hostiteli
  # nechalo jádro dotáhnout legacy tabulku. Jen když legacy filter už existuje.
  if [ -r "$PROC_NET/ip_tables_names" ] && grep -qx filter "$PROC_NET/ip_tables_names" 2>/dev/null; then
    iptables-legacy -w -n -L DOCKER-USER >/dev/null 2>&1 && leg=1
  fi
  if [ "$nft" = 1 ] && [ "$leg" = 1 ]; then
    chyba "DOCKER-USER je v nf_tables i v legacy — nevím, který backend Docker používá"; return 1
  fi
  if [ "$nft" = 0 ] && [ "$leg" = 0 ]; then
    chyba "řetěz DOCKER-USER nenalezen ani v nf_tables, ani v legacy (Docker neběží, nebo má firewall v nativním nftables) — nenabíhám"
    return 1
  fi
  if [ "$nft" = 1 ]; then BACKEND=nft; ZNAK_V="(nf_tables)"; else BACKEND=legacy; ZNAK_V="(legacy)"; fi
  for b in "iptables-$BACKEND" "ip6tables-$BACKEND"; do
    verze="$("$b" -V 2>/dev/null)"
    case "$verze" in
      *"$ZNAK_V"*) ;;
      *) chyba "Docker drží DOCKER-USER v backendu $BACKEND, ale '$b -V' hlásí '$verze' — nenabíhám (pravidla by šla jinam, než čte jádro)"
         BACKEND=""; return 1 ;;
    esac
  done
  log "backend: $BACKEND ($(iptables-$BACKEND -V 2>/dev/null))"
}

ipt() {  # $1 = 4|6, zbytek = argumenty
  r="$1"; shift
  if [ "$r" = 4 ]; then "iptables-$BACKEND" -w "$@"; else "ip6tables-$BACKEND" -w "$@"; fi
}

ipt_restore() {  # $1 = 4|6, stdin = payload
  if [ "$1" = 4 ]; then "iptables-$BACKEND-restore" --noflush -w; else "ip6tables-$BACKEND-restore" --noflush -w; fi
}

ipt_save() {  # $1 = 4|6
  if [ "$1" = 4 ]; then "iptables-$BACKEND-save" -c -t filter; else "ip6tables-$BACKEND-save" -c -t filter; fi
}

v6_v_jadre() { [ -e "$PROC_NET/if_inet6" ]; }

# ── Pravidla (jen vlastní řetězce; payload pro iptables-restore --noflush) ───
icmp_pravidla() {  # $1 = 4|6, $2 = řetězec, $3 = in|fwd
  if [ "$1" = 4 ]; then
    for t in destination-unreachable time-exceeded parameter-problem; do
      printf -- '-A %s -p icmp --icmp-type %s -m comment --comment %s -j RETURN\n' "$2" "$t" "$ZNACKA"
    done
  else
    for t in destination-unreachable packet-too-big time-exceeded parameter-problem; do
      printf -- '-A %s -p ipv6-icmp --icmpv6-type %s -m comment --comment %s -j RETURN\n' "$2" "$t" "$ZNACKA"
    done
    # Objevování sousedů (NDP) je pro IPv6 totéž co ARP — bez něj nefunguje nic.
    if [ "$3" = in ]; then
      for t in neighbour-solicitation neighbour-advertisement router-solicitation router-advertisement; do
        printf -- '-A %s -p ipv6-icmp --icmpv6-type %s -m comment --comment %s -j RETURN\n' "$2" "$t" "$ZNACKA"
      done
    fi
  fi
}

zbytek_cil() { if [ "$REZIM" = enforce ]; then echo DROP; else echo RETURN; fi; }

payload() {  # $1 = 4|6 → celé *filter s oběma vlastními řetězci
  r="$1"
  if [ "$r" = 4 ]; then cidrs="$CIDR4"; else cidrs="$CIDR6"; fi
  cil="$(zbytek_cil)"
  printf '*filter\n'
  printf ':%s - [0:0]\n' "$RETEZ_IN"
  printf ':%s - [0:0]\n' "$RETEZ_FWD"
  # ── INPUT veřejného rozhraní ──
  # První pravidlo nese identitu vlastníka uzlu — podle ní pozná firewall jiného forku cizí řetězce (F2).
  printf -- '-A %s -i lo -m comment --comment %s -j RETURN\n' "$RETEZ_IN" "$ZNACKA_VLASTNIK"
  printf -- '-A %s -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment %s -j RETURN\n' "$RETEZ_IN" "$ZNACKA"
  icmp_pravidla "$r" "$RETEZ_IN" in
  for c in $cidrs; do
    printf -- '-A %s -s %s -p tcp --dport 22 -m comment --comment %s -j RETURN\n' "$RETEZ_IN" "$c" "$ZNACKA_SPRAVA"
  done
  # SSH hostitele komukoli — JEN s deklarací ACCEL_FW_SSH=svet, JEN tcp/22, JEN INPUT.
  if [ "$SSH_KOMU" = svet ]; then
    printf -- '-A %s -p tcp --dport 22 -m comment --comment %s -j RETURN\n' "$RETEZ_IN" "$ZNACKA_SSH_SVET"
  fi
  for c in $cidrs; do
    printf -- '-A %s -s %s -m comment --comment %s -j RETURN\n' "$RETEZ_IN" "$c" "$ZNACKA_ZE_SPRAVY"
  done
  [ -z "$UDP_MESH" ] || printf -- '-A %s -p udp --dport %s -m comment --comment %s:mesh -j RETURN\n' "$RETEZ_IN" "$UDP_MESH" "$ZNACKA"
  printf -- '-A %s -m comment --comment %s:zbytek -j %s\n' "$RETEZ_IN" "$ZNACKA" "$cil"
  # ── z veřejného rozhraní do dockerových mostů (publikované porty kontejnerů) ──
  printf -- '-A %s -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment %s -j RETURN\n' "$RETEZ_FWD" "$ZNACKA_VLASTNIK"
  icmp_pravidla "$r" "$RETEZ_FWD" fwd
  for c in $cidrs; do
    printf -- '-A %s -s %s -m comment --comment %s -j RETURN\n' "$RETEZ_FWD" "$c" "$ZNACKA_ZE_SPRAVY"
  done
  [ -z "$UDP_MESH" ] || printf -- '-A %s -p udp -m conntrack --ctorigdstport %s -m comment --comment %s:mesh -j RETURN\n' "$RETEZ_FWD" "$UDP_MESH" "$ZNACKA"
  printf -- '-A %s -m comment --comment %s:zbytek -j %s\n' "$RETEZ_FWD" "$ZNACKA" "$cil"
  printf 'COMMIT\n'
}

pocet_pravidel() {  # $1 = 4|6, $2 = řetězec → očekávaný počet -A v payloadu
  payload "$1" | grep -c "^-A $2 "
}

# Skoky do cizích řetězců — jediný dotek mimo vlastní řetězce. Tvar je PEVNÝ,
# takže -C / -D míří přesně na ně a nic jiného.
skok_in() { printf '%s\n' "INPUT -i $ROZHRANI -m comment --comment $ZNACKA -j $RETEZ_IN"; }
skoky_fwd() {
  for m in $DOCKER_MOSTY; do
    printf '%s\n' "DOCKER-USER -i $ROZHRANI -o $m -m comment --comment $ZNACKA -j $RETEZ_FWD"
  done
}

# ── Plán (DRY_RUN) ───────────────────────────────────────────────────────────
vypis_plan() {
  # Popis pro výpis, ne hodnota: prázdná deklarace UDP meshe = port zavřený.
  udp_popis=zavřeno
  [ -z "${UDP_MESH:-}" ] || udp_popis=$UDP_MESH
  log "PLÁN (DRY_RUN — nic se nemění): režim=$REZIM ssh=$SSH_KOMU rozhraní=$ROZHRANI backend=$POPIS_BACKENDU udp-mesh=$udp_popis"
  for r in 4 6; do
    printf '# --- IPv%s: iptables-restore --noflush (jen vlastní řetězce) ---\n' "$r"
    payload "$r"
    printf '# --- IPv%s: skoky (vloženy AŽ po naplnění řetězců, -C || -I … 1) ---\n' "$r"
    printf -- '-I %s\n' "$(skok_in)" | sed 's/^-I INPUT /-I INPUT 1 /'
    skoky_fwd | while IFS= read -r s; do printf -- '-I %s\n' "$s" | sed 's/^-I DOCKER-USER /-I DOCKER-USER 1 /'; done
  done
}

# ── Nasazení jedné rodiny ────────────────────────────────────────────────────
retez_existuje() { ipt "$1" -n -L "$2" >/dev/null 2>&1; }

retez_sedi() {  # $1 = 4|6 → 0, když vlastní řetězce nesou přesně plán (+ případná značka potvrzení)
  r="$1"
  for ret in "$RETEZ_IN" "$RETEZ_FWD"; do
    vypis="$(ipt "$r" -S "$ret" 2>/dev/null)" || return 1
    # Počet nejdřív (levné), pak každé pravidlo sémanticky (-C) — výpis -S jádro
    # normalizuje (`-m tcp`, `/32`), takže se text s plánem porovnávat nedá.
    ma="$(printf '%s\n' "$vypis" | grep -c "^-A $ret ")"
    znacky="$(printf '%s\n' "$vypis" | grep "^-A $ret " | grep -c "$ZNACKA_POTVRZENO")"
    [ "$((ma - znacky))" -eq "$(pocet_pravidel "$r" "$ret")" ] || return 1
    payload "$r" | grep "^-A $ret " | sed "s/^-A $ret //" | while IFS= read -r spec; do
      # shellcheck disable=SC2086  # specifikace pravidla se dělí na argumenty záměrně
      ipt "$r" -C "$ret" $spec >/dev/null 2>&1 || { echo chybi; break; }
    done | grep -q chybi && return 1
  done
  return 0
}

vloz_skok() {  # $1 = 4|6, $2 = "ŘETĚZ spec…"
  r="$1"; ret="${2%% *}"; spec="${2#* }"
  # shellcheck disable=SC2086
  ipt "$r" -C "$ret" $spec >/dev/null 2>&1 && return 0
  # shellcheck disable=SC2086
  ipt "$r" -I "$ret" 1 $spec
}

nasad_rodinu() {  # $1 = 4|6
  r="$1"
  if ! payload "$r" | ipt_restore "$r"; then
    chyba "IPv$r: iptables-restore --noflush selhal"; return 1
  fi
  if ! retez_sedi "$r"; then
    chyba "IPv$r: vlastní řetězce po zápisu neodpovídají plánu"; return 1
  fi
  # Skoky AŽ do naplněných řetězců.
  vloz_skok "$r" "$(skok_in)" || { chyba "IPv$r: skok z INPUT se nevložil"; return 1; }
  if retez_existuje "$r" DOCKER-USER; then
    for s in $(skoky_fwd | tr ' ' '\037'); do
      vloz_skok "$r" "$(printf '%s' "$s" | tr '\037' ' ')" || { chyba "IPv$r: skok z DOCKER-USER se nevložil"; return 1; }
    done
  else
    log "IPv$r: DOCKER-USER neexistuje — Docker tu forward nespravuje, skok do $RETEZ_FWD odložen (smyčka ho doplní)"
  fi
}

skoky_sedi() {  # $1 = 4|6
  r="$1"
  # shellcheck disable=SC2086
  ipt "$r" -C $(skok_in) >/dev/null 2>&1 || return 1
  if retez_existuje "$r" DOCKER-USER; then
    for s in $(skoky_fwd | tr ' ' '\037'); do
      # shellcheck disable=SC2086
      ipt "$r" -C $(printf '%s' "$s" | tr '\037' ' ') >/dev/null 2>&1 || return 1
    done
  fi
}

# ── Návrat: sundat JEN svoje ─────────────────────────────────────────────────
sundej_rodinu() {  # $1 = 4|6
  r="$1"; ok=0
  for s in $( { skok_in; skoky_fwd; } | tr ' ' '\037'); do
    spec="$(printf '%s' "$s" | tr '\037' ' ')"
    ret="${spec%% *}"; zbytek="${spec#* }"
    retez_existuje "$r" "$ret" || continue
    # shellcheck disable=SC2086
    while ipt "$r" -C "$ret" $zbytek >/dev/null 2>&1; do
      # shellcheck disable=SC2086
      ipt "$r" -D "$ret" $zbytek || { ok=1; break; }
    done
  done
  for ret in "$RETEZ_IN" "$RETEZ_FWD"; do
    retez_existuje "$r" "$ret" || continue
    ipt "$r" -F "$ret" || ok=1
    if ! ipt "$r" -X "$ret" 2>/dev/null; then
      chyba "IPv$r: řetězec $ret nejde smazat — odkazuje na něj pravidlo, které hostfw nevložil v tomto tvaru (jiné rozhraní?); vyprázdněn, ponechán"
      ok=1
    fi
  done
  return "$ok"
}

rodiny() { if v6_v_jadre; then echo "4 6"; else echo "4"; fi; }

# ── Vlastník NA UZLU (F2): čí jsou existující řetězce AISHA-HOSTFW-*? ─────────
# Jen ČTENÍ (-S). Vypíše příčinu, proč na ně tahle instance nesmí sáhnout, nebo nic:
#   • řetězec nese značku jiného vlastníka → „vlastník <x>",
#   • řetězec existuje bez značky vlastníka → nevím čí (starší verze, ruční zásah).
# Žádný vlastní řetězec = čistý uzel, nic. Vlastní značka = nic (idempotentně).
cizi_retezce() {
  for r in $(rodiny); do
    for ret in "$RETEZ_IN" "$RETEZ_FWD"; do
      vypis="$(ipt "$r" -S "$ret" 2>/dev/null)" || continue
      vlastnici="$(printf '%s\n' "$vypis" | sed -n 's/.*aisha-hostfw:vlastnik:\([a-z0-9-]*\).*/\1/p' | sort -u)"
      if [ -z "$vlastnici" ]; then
        printf 'IPv%s: řetězec %s existuje bez identity vlastníka — nevím čí; nesahám (uklidit smí jen jeho firewall: hostfw.sh --vrat)\n' "$r" "$ret"
        return 0
      fi
      for v in $vlastnici; do
        if [ "$v" != "$VLASTNIK_UZLU" ]; then
          printf 'IPv%s: řetězec %s patří vlastníkovi %s, ne %s — dva firewally na jednom stroji; STOP, pravidla se nemění\n' "$r" "$ret" "$v" "$VLASTNIK_UZLU"
          return 0
        fi
      done
    done
  done
}

sundej_vse() {
  rc=0
  for r in $(rodiny); do sundej_rodinu "$r" || rc=1; done
  return "$rc"
}

# ── Potvrzení enforce: nárůst čítače SSH ze správy ───────────────────────────
citac_spravy() {
  soucet=0
  for r in $(rodiny); do
    n="$(ipt_save "$r" 2>/dev/null | awk -v z="$ZNACKA_SPRAVA" 'index($0, z) && match($0, /^\[[0-9]+:/) { s += substr($0, 2, RLENGTH - 2) } END { print s + 0 }')"
    soucet=$((soucet + n))
  done
  echo "$soucet"
}

otisk_planu() { { payload 4; payload 6; echo "$ROZHRANI"; } | cksum | awk '{print $1}'; }

znacka_potvrzeni() { printf '%s:%s' "$ZNACKA_POTVRZENO" "$(otisk_planu)"; }

je_potvrzeno() {  # táž sada už potvrzená (značka s otiskem na konci vlastního řetězce)?
  for r in $(rodiny); do
    ipt "$r" -S "$RETEZ_IN" 2>/dev/null | grep -qF -- "$(znacka_potvrzeni)" || return 1
  done
}

oznac_potvrzeno() {
  # Značka je pravidlo BEZ cíle za koncovým pravidlem — nic nepropouští ani
  # nezahazuje, jen nese otisk potvrzené sady pro příští start kontejneru.
  for r in $(rodiny); do
    ipt "$r" -A "$RETEZ_IN" -m comment --comment "$(znacka_potvrzeni)" || return 1
  done
}

cekej_na_potvrzeni() {
  zaklad="$(citac_spravy)"
  konec=$(( $(date +%s) + POTVRZENI_S ))
  zapis_stav CEKA_NA_POTVRZENI "enforce: čekám ${POTVRZENI_S} s na nové SSH spojení ze správy (čítač ${zaklad})"
  while [ "$(date +%s)" -lt "$konec" ]; do
    sleep "$KROK_S" & wait $!
    ted="$(citac_spravy)"
    if [ "$ted" -gt "$zaklad" ]; then
      log "potvrzeno: čítač SSH ze správy ${zaklad} → ${ted}"
      oznac_potvrzeno || { chyba "značku potvrzení se nepodařilo zapsat"; return 1; }
      return 0
    fi
  done
  return 1
}

# ── Běh ──────────────────────────────────────────────────────────────────────
drz() {  # drží kontejner naživu (stav čte healthcheck); TERM ukončí bez zásahu do pravidel
  while :; do sleep 3600 & wait $!; done
}

trap 'log "ukončuji (pravidla zůstávají — přebírá je další start)"; exit 0' TERM INT

selhani() {  # $1 = důvod; sundá vlastní pravidla, pokud backend znám — a jen VLASTNÍ (F2)
  if [ -n "${BACKEND:-}" ] && [ -n "${ROZHRANI:-}" ]; then
    cizi="$(cizi_retezce)"
    if [ -n "$cizi" ]; then
      chyba "nesundávám nic: $cizi"
    else
      sundej_vse || chyba "sundání vlastních pravidel nebylo úplné (viz výš)"
    fi
  fi
  zapis_stav SELHALO "$1"
  drz
}

zdravi() {
  stav="$(cti_stav stav)" || { echo "stav neznámý"; return 1; }
  case "$stav" in
    MERENI|VYNUCENO) ;;
    *) echo "stav $stav: $(cti_stav duvod)"; return 1 ;;
  esac
  BACKEND="$(cti_stav backend)"; ROZHRANI="$(cti_stav rozhrani)"
  [ -n "$BACKEND" ] && [ -n "$ROZHRANI" ] || { echo "stav bez backendu/rozhraní"; return 1; }
  # shellcheck disable=SC2086
  ipt 4 -C $(skok_in) >/dev/null 2>&1 || { echo "skok z INPUT chybí"; return 1; }
  echo "stav $stav"
}

case "${1:-}" in
  --zdravi) zdravi; exit $? ;;
  --plan) DRY_RUN=1; PLAN_JEN=1 ;;
  --vrat) VRAT=1 ;;
  "") ;;
  *) echo "použití: hostfw.sh [--plan|--zdravi|--vrat]" >&2; exit 2 ;;
esac

# ── Vlastník uzlu: PRVNÍ otázka, před jakýmkoli dotekem pravidel ─────────────
# Dva firewally na jednom stroji by se praly o tytéž řetězce (a cizí by při
# vlastním selhání sundal pravidla vlastníka). Cizí instance proto nesmí ani
# zjišťovat backend, ani sundávat — jen říct proč a stát.
if ! vlastnik_vystup="$(node "$DEKLARACE" --vlastnik 2>&1)"; then
  chyba "$vlastnik_vystup"
  if [ "$PLAN_JEN" = 1 ] || [ "$VRAT" = 1 ]; then exit 1; fi
  zapis_stav SELHALO "nejsem vlastník uzlu — $(printf '%s' "$vlastnik_vystup" | sed 's/^accel-deklarace: //' | head -1)"
  drz
fi
VLASTNIK_UZLU="$(printf '%s\n' "$vlastnik_vystup" | sed -n 's/^vlastnik=//p' | head -1)"
case "$VLASTNIK_UZLU" in
  ''|*[!a-z0-9-]*) chyba "výklad deklarace nevydal identitu vlastníka uzlu ('$VLASTNIK_UZLU') — nenabíhám"
     if [ "$PLAN_JEN" = 1 ] || [ "$VRAT" = 1 ]; then exit 1; fi
     zapis_stav SELHALO "identita vlastníka uzlu nevydána"; drz ;;
esac
ZNACKA_VLASTNIK="$ZNACKA:vlastnik:$VLASTNIK_UZLU"

# DRY_RUN je přepínač bezpečnostního nástroje: výslovné 1 = jen náhled, 0 nebo
# nenastaveno = ostrý běh. Cokoli jiného se NEVYKLÁDÁ (ani jako náhled, ani jako
# ostrý běh) — neznámý přepínač znamená, že firewall nenaběhne.
case "${DRY_RUN:-}" in
  1) JEN_NAHLED=1 ;;
  ''|0) JEN_NAHLED=0 ;;
  *) JEN_NAHLED=neznamy ;;
esac

if [ "$VRAT" = 1 ]; then
  zjisti_rozhrani || exit 1
  zjisti_backend || exit 1
  # Řetězce JINÉHO vlastníka se nesundávají ani ručně; bez identity ano (ruční úklid).
  cizi="$(cizi_retezce)"
  case "$cizi" in
    *"patří vlastníkovi"*) chyba "$cizi"; exit 1 ;;
  esac
  sundej_vse && { zapis_stav VRACENO "ručně (--vrat)"; exit 0; }
  exit 1
fi

# Stav z dřívějška (jiný start, jiná sada) nic neříká o tomhle běhu.
[ "$PLAN_JEN" = 1 ] || zapis_stav STARTUJE "načítám deklarace"

if [ "$JEN_NAHLED" = neznamy ]; then
  zjisti_rozhrani 2>/dev/null && zjisti_backend 2>/dev/null || BACKEND=""
  selhani "DRY_RUN='${DRY_RUN}' není 0 ani 1 — neznámý přepínač, firewall NENABĚHNE (fail-closed, žádný DROP)"
fi
over_cislo HOSTFW_KROK_S "$KROK_S" 1 3600 || { [ "$PLAN_JEN" = 1 ] && exit 1; selhani "HOSTFW_KROK_S neplatný"; }

if ! nacti_deklaraci; then
  [ "$PLAN_JEN" = 1 ] && exit 1
  zjisti_rozhrani 2>/dev/null && zjisti_backend 2>/dev/null || BACKEND=""
  selhani "deklarace ACCEL_FW_MODE / ACCEL_FW_SSH / ACCEL_FW_ADMIN_CIDRS neplatná — firewall NENABĚHNE (fail-closed, žádný DROP)"
fi
POTVRZENI_S="${ACCEL_FW_CONFIRM_S:-}"
INTERVAL_S="${ACCEL_FW_INTERVAL_S:-}"
over_cislo ACCEL_FW_CONFIRM_S "$POTVRZENI_S" 10 86400 || { [ "$PLAN_JEN" = 1 ] && exit 1; selhani "ACCEL_FW_CONFIRM_S neplatný"; }
over_cislo ACCEL_FW_INTERVAL_S "$INTERVAL_S" 5 3600 || { [ "$PLAN_JEN" = 1 ] && exit 1; selhani "ACCEL_FW_INTERVAL_S neplatný"; }
zjisti_rozhrani || { [ "$PLAN_JEN" = 1 ] && exit 1; selhani "veřejné rozhraní neurčeno"; }

if [ "$JEN_NAHLED" = 1 ]; then
  # Backend se pro náhled jen zjišťuje; když zjistit nejde, plán to řekne slovem.
  if zjisti_backend 2>/dev/null; then POPIS_BACKENDU="$BACKEND"; else BACKEND=""; POPIS_BACKENDU="nezjištěn"; fi
  vypis_plan
  [ "$PLAN_JEN" = 1 ] && exit 0
  BACKEND=""
  zapis_stav NAHLED "DRY_RUN=1 — plán vypsán, nic nenasazeno"
  drz
fi

zjisti_backend || selhani "backend Dockeru neověřen — žádná pravidla"
v6_v_jadre || log "jádro bez IPv6 — dvojče ip6tables není kam nasadit"

# Vlastník NA UZLU (F2): před PRVNÍM zápisem se čte, čí jsou existující řetězce.
# Cizí nebo bez identity = STOP bez jediné změny — ne selhani (to by sundávalo).
cizi="$(cizi_retezce)"
if [ -n "$cizi" ]; then
  chyba "$cizi"
  zapis_stav SELHALO "$cizi"
  drz
fi

# Táž sada už na místě (restart kontejneru, přenasazení beze změny)? Pak se NEPŘEPISUJE:
# zápis by vynuloval čítače a smazal značku potvrzení — enforce by znovu čekal na
# potvrzení, ačkoli se na pravidlech nic nezměnilo.
vse_sedi() {
  for r in $(rodiny); do
    retez_sedi "$r" && skoky_sedi "$r" || return 1
  done
}
if vse_sedi && { [ "$REZIM" = measure ] || je_potvrzeno; }; then
  log "vlastní pravidla už odpovídají plánu — beze změny (čítače i potvrzení zůstávají)"
  SADA_NA_MISTE=1
else
  SADA_NA_MISTE=0
  for r in $(rodiny); do
    nasad_rodinu "$r" || selhani "IPv$r: nasazení selhalo — vlastní pravidla sundána"
  done
fi

if [ "$REZIM" = measure ]; then
  zapis_stav MERENI "measure: čítače bez DROP"
elif [ "$SADA_NA_MISTE" = 1 ]; then
  zapis_stav VYNUCENO "enforce: táž sada už potvrzená (otisk $(otisk_planu))"
elif cekej_na_potvrzeni; then
  zapis_stav VYNUCENO "enforce potvrzen novým SSH spojením ze správy"
else
  if sundej_vse; then
    zapis_stav VRACENO "enforce NEPOTVRZEN do ${POTVRZENI_S} s (žádné nové SSH spojení ze správy) — vlastní skoky a řetězce sundány"
  else
    zapis_stav VRACENO "enforce NEPOTVRZEN a sundání nebylo úplné — viz log"
  fi
  drz
fi

# Smyčka: vlastní pravidla na místě? Chybějící doplní (táž sada, potvrzení se nemění).
while :; do
  sleep "$INTERVAL_S" & wait $!
  cizi="$(cizi_retezce)"
  if [ -n "$cizi" ]; then
    # Řetězce mezitím přepsal firewall jiného vlastníka: nepřetahovat se, stát a říct proč.
    chyba "$cizi"
    zapis_stav SELHALO "$cizi"
    drz
  fi
  for r in $(rodiny); do
    if ! retez_sedi "$r"; then
      log "IPv$r: vlastní řetězce neodpovídají plánu — obnovuji"
      payload "$r" | ipt_restore "$r" || { chyba "IPv$r: obnova řetězců selhala"; continue; }
      if [ "$REZIM" = enforce ]; then
        ipt "$r" -A "$RETEZ_IN" -m comment --comment "$(znacka_potvrzeni)" || chyba "IPv$r: značka potvrzení se nezapsala"
      fi
    fi
    if ! skoky_sedi "$r"; then
      log "IPv$r: skok chybí — doplňuji"
      vloz_skok "$r" "$(skok_in)" || chyba "IPv$r: skok z INPUT se nevložil"
      if retez_existuje "$r" DOCKER-USER; then
        for s in $(skoky_fwd | tr ' ' '\037'); do
          vloz_skok "$r" "$(printf '%s' "$s" | tr '\037' ' ')" || chyba "IPv$r: skok z DOCKER-USER se nevložil"
        done
      fi
    fi
  done
done
