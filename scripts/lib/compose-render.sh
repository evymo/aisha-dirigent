#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SDÍLENÉ RENDEROVÁNÍ COMPOSE PRO ORÁKULA
#
# Compose se nedá číst řádkovým skenem. Kotvy (`<<: *anchor`), seznamy vs.
# slovníky, interpolace i escapované `$$` mění význam textu — a každý sken,
# který si to modeluje sám, se dřív nebo později zeptá na JINOU otázku, než
# jakou chtěl. Dnes (2026-08-16) se to stalo třikrát: detektor overlayů neviděl
# YAML sloučení, kontrola „alias JE" trefovala `container_name`, který Coolify
# zahazuje.
#
# Proto se ptáme PARSERU. Tenhle soubor je JEDEN domov pro to, jak se compose
# vyrenderuje k měření — aby dvě orákula, která se ptají na různé věci, měřila
# prokazatelně TÝŽ dokument. Kdyby si každé stavělo atrapy po svém, rozešly by
# se jim renderované soubory a rozdíl by nikdo nezachytil: obě by hlásila zeleň
# nad jinou skutečností.
#
# Použití:
#   . scripts/lib/compose-render.sh
#   compose_render_json <soubor> [PREFIX]   # JSON na stdout, rc=1 při selhání
# ─────────────────────────────────────────────────────────────────────────────

# Pevná identita instance pro měření. NENÍ to výchozí hodnota pro nasazení —
# compose má u `${APP_NAME_PREFIX:?}` záměrně fail-loud a tak to zůstává. Tohle
# je atrapa, aby šlo změřit, jak jméno vypadá PO dosazení identity.
#
# Musí být ODLIŠNÁ od tvaru generických atrap níž (`orakulum-<klíč>`). Kdyby se
# překrývaly, každá atrapa hodnoty by vypadala jako prefixované jméno služby a
# orákulum na jména by hlásilo stovky nálezů, které v souboru nejsou.
COMPOSE_RENDER_PREFIX="${COMPOSE_RENDER_PREFIX:-zkouskainstance}"

# ── Náhradní hodnoty podle STRUKTURNÍ ROLE ───────────────────────────────────
# Prázdná hodnota by nestačila: `ports: - "${X}:80"` chce číslo, `subnet:` chce
# CIDR, `ipv4_address:` chce adresu. Parser je typový, náhrada musí být taky —
# jinak by orákulum hlásilo vadu tam, kde je jen špatná atrapa.
#
# Tabulka žije v AWK, ne v shellu, a má JEDEN domov. Důvod je výkonnostní:
# renderování ji potřebuje pro každou proměnnou (přes sto na soubor), a shellová
# `case` v cyklu znamená fork na každou z nich — přes tři tisíce na běh. Awk
# vyhodnotí celý soubor jedním procesem.
#
# Přepsat ji do dvou jazyků by byl druhý domov: tabulky by se rozešly a dvě
# orákula by měřila nad jinak vyrenderovaným dokumentem, aniž by to kdokoli
# zachytil. Proto shellová funkce níž awk VOLÁ, neopakuje ho.
_COMPOSE_DUMMY_AWK='
function atrapa(k,   s) {
  # Identita se dosazuje PEVNĚ — právě o ni jde v měření jmen.
  if (k == "APP_NAME_PREFIX")                       return PREFIX
  # Proměnná, která je CELÝM zdrojem svazku (`- "${X}:/cíl"`, `source: ${X}`),
  # nese hostitelskou cestu instance. Atrapa musí být ABSOLUTNÍ cesta: holé
  # `orakulum-x` by docker compose četl jako jméno pojmenovaného svazku
  # („refers to undefined volume") a render by padl na atrapě, ne na souboru.
  # Rozhoduje ROLE v souboru (seznam CESTY), ne jméno proměnné.
  if (index(" " CESTY " ", " " k " ")) { s = tolower(k); gsub(/_/, "-", s); return "/orakulum/" s }
  # RFC 5737 TEST-NET-1 — rozsah vyhrazený normou PRÁVĚ pro příklady a testy.
  # Záměrně NE 10./172.16./192.168.: adresa z privátního rozsahu ve zdrojáku je
  # k nerozeznání od skutečné infrastruktury (hlídá brána no-hardcoded-network)
  # a atrapa nemá vypadat jako adresa, která někam vede.
  if (k ~ /SUBNET/)                                 return "192.0.2.0/24"
  # Kotvy `$` jsou tu ZÁMĚR, ne kosmetika: shellové globy `*_IP` a `*_ADDRESS`
  # jsou SUFIXOVÉ. Bez kotvy by `COSMOS_ADDRESS_PREFIX` dostal IP adresu místo
  # jména — atrapa jiného typu, tedy měření nad jinak vyrenderovaným souborem.
  if (k ~ /(_IP$|_IP_|IPV4|_ADDRESS$)/)             return "192.0.2.2"
  if (k ~ /(PORT$|PORT_|_PORTS$)/)                  return "18080"
  if (k ~ /(CPUS|_CPU$)/)                           return "1.0"
  if (k ~ /(_MEM$|MEMORY|_MEM_)/)                   return "512m"
  if (k ~ /^IMAGE_/ || k ~ /_IMAGE$/)               return "alpine:3"
  if (k == "REGISTRY_PROXY")                        return ""
  if (k ~ /ENABLED/ || k ~ /_ON$/)                  return "false"
  if (k ~ /PROFILES/)                               return ""
  # Atrapa musí být pro každý klíč JINÁ. Stejná hodnota na dvou místech
  # `extra_hosts` udělá dva stejné hostitele a compose to odmítne — což by
  # vypadalo jako děravé odvození, ačkoli je to jen kolize atrap.
  s = tolower(k); gsub(/_/, "-", s)
  return "orakulum-" s
}'

compose_dummy_value() {
  awk -v PREFIX="$COMPOSE_RENDER_PREFIX" -v K="$1" \
    "$_COMPOSE_DUMMY_AWK"' BEGIN { printf "%s", atrapa(K) }' </dev/null
}

# Každé jméno proměnné, které se v souboru vyskytne — MAXIMÁLNÍ množina.
compose_all_names() {
  grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$1" | sed 's/^\${//' | sort -u
}

# Proměnné, které jsou CELÝM zdrojem svazku — krátký (`- "${X}:/cíl"`) i dlouhý
# (`source: ${X}`) tvar, a to JEN uvnitř `volumes:` služby. Stejný řádkový tvar
# má i `extra_hosts: - "${HOST}:ip"`; tam musí zůstat atrapa jména, ne cesta.
# Jeden proces awk na soubor (výkon: viz komentář u tabulky atrap).
compose_volume_source_names() {
  awk '
    function odsazeni(r) { match(r, /^[ ]*/); return RLENGTH }
    /^[ ]*(#|$)/ { next }
    {
      o = odsazeni($0)
      if (vbloku && o <= vodsaz) vbloku = 0
      if ($0 ~ /^[ ]+volumes:[ ]*$/) { vbloku = 1; vodsaz = o; next }
      if (!vbloku) next
      if (match($0, /^[ ]*(-[ ]*["\047]?|source:[ ]*["\047]?)\$\{[A-Za-z_][A-Za-z0-9_]*\}(["\047]?[ ]*$|:)/)) {
        r = substr($0, RSTART, RLENGTH); sub(/^[^$]*\$\{/, "", r); sub(/\}.*$/, "", r); print r
      }
    }' "$1" | sort -u
}

# Odkaz s vlastní náhradou (`${X:-…}` / `${X-…}`) hodnotu při parsování
# NEPOTŘEBUJE — prázdno spustí náhradu. Rozhoduje existence HOLÉHO odkazu.
compose_has_bare_ref() {
  grep -qE "\\\$\\{$2(\\}|:\\?)" "$1"
}

# Táž otázka jako `compose_has_bare_ref`, ale položená JEDNOU za celý soubor.
#
# Renderování volalo předchozí predikát pro KAŽDÉ jméno zvlášť — přes sto grepů
# na soubor, přes tři tisíce na běh. Nebyl to docker, kdo orákulum zdržoval;
# byla to otázka položená v cyklu místo jednou. Doktor tím přerostl 120s limit
# vlastní brány.
compose_bare_names() {
  grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*(\}|:\?)' "$1" \
    | sed -E 's/^\$\{//; s/(\}|:\?)$//' | sort -u
}

# Vyrenderuje soubor do JSON s MAXIMÁLNÍ množinou atrap.
#
# `env -i` je jádro: běh NESMÍ vidět nic z prostředí operátora, jinak by se do
# renderu propsala hodnota, kterou nasazení mít nebude, a měřili bychom svůj
# vlastní shell. PATH musí zůstat, aby se našel docker sám.
#
# rc=0 → JSON na stdout; rc=1 → soubor se nevyrenderoval (overlay nebo vada),
# důvod na stderr. rc=2 → docker chybí, tedy NEZMĚŘENO.
compose_render_json() {
  local soubor="$1" envfile vystup rc
  if ! docker compose version >/dev/null 2>&1; then
    echo "NEZMĚŘENO: 'docker compose' není k dispozici." >&2
    return 2
  fi
  [ -n "${2:-}" ] && COMPOSE_RENDER_PREFIX="$2"

  # CELÝ env soubor vznikne JEDNÍM procesem: jména i jejich atrapy. Dřív to byl
  # cyklus se substitucí příkazu na každý klíč — fork na proměnnou, přes tři
  # tisíce na běh, a orákulum tím zdrželo doktora přes 120s limit vlastní brány.
  envfile=$(mktemp)
  local cesty
  cesty=$(compose_volume_source_names "$soubor" | tr '\n' ' ')
  compose_bare_names "$soubor" \
    | awk -v PREFIX="$COMPOSE_RENDER_PREFIX" -v CESTY="$cesty" \
        "$_COMPOSE_DUMMY_AWK"' NF { printf "%s=%s\n", $0, atrapa($0) }' > "$envfile"
  # Prázdný env NENÍ „soubor bez proměnných" — u compose je to rozbité čtení.
  if [ ! -s "$envfile" ] && grep -q '\${' "$soubor"; then
    rm -f "$envfile"
    echo "NEZMĚŘENO: ${soubor} má \${…} odkazy, ale nevznikla žádná atrapa." >&2
    return 1
  fi

  # stderr se NESMÍ slít do stdout: `docker compose config` sype varování
  # („The X variable is not set") a ta by se dostala PŘED JSON. Výsledek by pak
  # nebyl JSON, ale text, který jako JSON vypadá až od druhého řádku — a jq by
  # padal na souboru, který se vyrenderoval správně.
  local errfile
  errfile=$(mktemp)
  vystup=$(env -i PATH="$PATH" HOME="$HOME" \
    docker compose --env-file "$envfile" -f "$soubor" config --format json 2>"$errfile")
  rc=$?
  rm -f "$envfile"
  if [ "$rc" -ne 0 ]; then
    grep -vE 'level=warning msg="The .* variable is not set' "$errfile" | head -3 >&2
    rm -f "$errfile"
    return 1
  fi
  rm -f "$errfile"
  printf '%s' "$vystup"
}
