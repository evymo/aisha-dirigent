#!/bin/sh
# =============================================================================
# reconcile-realm-clients.sh — deklarace klientů realmu KONVERGUJE, ne jen vzniká
# =============================================================================
# ⛔ PROČ EXISTUJE. `--import-realm` importuje POUZE na prázdný realm (první
# boot) — a je to záměr: re-deploy nesmí přerazit admina, který si mezitím
# změnil heslo (viz render-realm-and-start.sh). Jenže z toho plyne, že
# `keycloak/aisha-realm.json` je zdroj pravdy, který se ke KONZUMENTOVI dostane
# JEDNOU. Každá pozdější změna deklarace je tichá: soubor tvrdí jedno, běžící
# realm drží druhé, a nikdo ty dvě věci neporovnává.
#
# Naměřeno 2026-09-05 na produkci <fork>: klient `aisha-bootstrap` dostal
# v šabloně `"secret": "${AISHA_BOOTSTRAP_CLIENT_SECRET}"`, aby si realm
# předgenerovanou hodnotu PŘEVZAL — a na instanci, kde realm už existoval, se
# nestalo nic. `netbird-peer-discover` dál dostával „Pověření bootstrap
# uživatele chybí", edge se odmítal nasadit bez CORE_MESH_IP a celý mesh stál.
#
# ── CO DĚLÁ A CO NEDĚLÁ ──────────────────────────────────────────────────────
# DĚLÁ:   pro každého klienta, kterému ŠABLONA deklaruje `secret` odkazem na
#         proměnnou, srovná hodnotu v realmu s hodnotou v prostředí;
#         klientům, kterým šablona deklaruje `serviceAccountsEnabled: true`,
#         servisní účet ZAPNE (naměřeno 2026-09-07: secret bez něj = 401);
#         servisním účtům s ukazatelem `aisha.passwordFrom` srovná heslo.
# NEDĚLÁ: nesahá na uživatele, role, admin heslo ani na klienty, kterým šablona
#         secret nedeklaruje (těm ho vydává Keycloak a je to správně).
#
# Tím se původní obava „re-deploy nesmí přerazit admina" NERUŠÍ — jen se zúží
# na to, co skutečně chrání. Konvergovat má DEKLARACE, ne provozní stav.
#
# ── PROČ SE SEZNAM ODVOZUJE ZE ŠABLONY ───────────────────────────────────────
# Ručně držený seznam jmen tu už jednou byl a selhal přesně tak, jak se čeká:
# fork přidal klienta `openclaw-proxy` a nikdo seznam nedoplnil (viz
# render-realm-and-start.sh, Pass 2). Univerzum proto vzniká ze ŠABLONY —
# přibude-li klient se `secret`em, reconciler o něm ví hned.
#
# ── BEZ SSH, BEZ CURL, BEZ JQ ────────────────────────────────────────────────
# Běží UVNITŘ stacku proti vnitřní adrese Keycloaku, takže nepotřebuje, aby byl
# KC dosažitelný zvenčí — což na instanci za NAT před vznikem meshe ani nejde.
# Používá `kcadm.sh` z image (oficiální CLI) a busybox awk; curl ani jq v tom
# image nejsou.
# =============================================================================
set -eu

# ⛔ ŽÁDNÝ DOSAZENÝ LITERÁL U HODNOT, KTERÉ POPISUJÍ SVĚT. Chytila to ráčna
# `zadny-fallback-nad-identitou` a měla pravdu — nejvíc u adresy:
# `${KC_INTERNAL_URL:-http://127.0.0.1:8080}` by při zapomenutém předání tiše
# mluvil s localhostem místo aby řekl, že mu chybí konfigurace. Táž třída jako
# holé jméno na sdílené síti, na kterém mě chytila brána o pár hodin dřív.
#
# Cesta k šabloně je naopak KONSTANTA, ne odhad: soubor tam kladu týmž
# Dockerfilem, který kope tenhle skript. Není co přebíjet — kdo chce jinou
# cestu, mění image.
SABLONA="/opt/keycloak/aisha-realm.template.json"
KCADM="/opt/keycloak/bin/kcadm.sh"
KC_URL="${KC_INTERNAL_URL:?KC_INTERNAL_URL required — adresa Keycloaku se NEHÁDÁ; compose ji předává z ${KEYCLOAK_INTERNAL_URL}}"
REALM="${KEYCLOAK_REALM:?KEYCLOAK_REALM required — bez jména realmu není co srovnávat}"
ADMIN="${KEYCLOAK_ADMIN:?KEYCLOAK_ADMIN required — jméno admina se NEHÁDÁ; špatné by kcadm shodilo na nesrozumitelném 401}"
HESLO="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD required — bez něj se kcadm nepřihlásí}"

log() { echo "[realm-sync] $*"; }
umri() { echo "[realm-sync] CHYBA: $*" >&2; exit 1; }

[ -f "$SABLONA" ] || umri "šablona '$SABLONA' chybí — univerzum by bylo prázdné a smír by tiše neudělal nic"
[ -x "$KCADM" ] || umri "kcadm.sh nenalezen v '$KCADM'"

# ── Univerzum ze šablony: clientId + jméno proměnné ──────────────────────────
# Hledá dvojice `"clientId": "x"` … `"secret": "${VAR}"` uvnitř TÉHOŽ objektu.
# `secret` stojí v šabloně hned za `clientId`, ale awk se na pořadí nespoléhá:
# drží poslední viděný clientId a páruje ho s nejbližším `secret`em.
PARY="$(awk '
  match($0, /"clientId"[[:space:]]*:[[:space:]]*"[^"]+"/) {
    s = substr($0, RSTART, RLENGTH); gsub(/.*"clientId"[[:space:]]*:[[:space:]]*"/, "", s); gsub(/"$/, "", s)
    cid = s; next
  }
  match($0, /"secret"[[:space:]]*:[[:space:]]*"\$\{[A-Z_0-9]+\}"/) {
    s = substr($0, RSTART, RLENGTH); gsub(/.*\$\{/, "", s); gsub(/\}".*/, "", s)
    if (cid != "") { print cid "\t" s; cid = "" }
  }
' "$SABLONA")"

[ -n "$PARY" ] || umri "šablona nedeklaruje ANI JEDNOHO klienta se secretem z prostředí — buď se změnil její tvar, nebo awk přestal párovat; tiše projít nesmí"

log "šablona deklaruje $(echo "$PARY" | wc -l | tr -d ' ') klientů se secretem z prostředí"

# ── Přihlášení ───────────────────────────────────────────────────────────────
$KCADM config credentials --server "$KC_URL" --realm master \
  --user "$ADMIN" --password "$HESLO" >/dev/null 2>&1 \
  || umri "kcadm se nepřihlásil na $KC_URL (realm master, uživatel $ADMIN)"

zmeneno=0; shodne=0; preskoceno=0
echo "$PARY" | while IFS="$(printf '\t')" read -r CID VAR; do
  [ -n "$CID" ] || continue
  eval "HODNOTA=\${$VAR:-}"

  # Prázdná proměnná NENÍ důvod nulovat secret v realmu. Znamená jen, že tuhle
  # hodnotu instance nedeklaruje (vyloučená služba) — přerazit ji prázdnem by
  # rozbilo klienta, který dnes funguje.
  if [ -z "${HODNOTA:-}" ]; then
    log "  $CID — $VAR prázdná, PŘESKAKUJI (realm si drží svou)"
    preskoceno=$((preskoceno+1)); continue
  fi

  UUID="$($KCADM get clients -r "$REALM" -q "clientId=$CID" --fields id --format csv --noquotes 2>/dev/null | head -1 || true)"
  if [ -z "$UUID" ]; then
    log "  $CID — v realmu NENÍ, přeskakuji (klienta zakládá import, ne smír)"
    preskoceno=$((preskoceno+1)); continue
  fi

  STAVAJICI="$($KCADM get "clients/$UUID/client-secret" -r "$REALM" --fields value --format csv --noquotes 2>/dev/null | head -1 || true)"
  if [ "$STAVAJICI" = "$HODNOTA" ]; then
    log "  $CID — shoda, nic nedělám"
    shodne=$((shodne+1)); continue
  fi

  $KCADM update "clients/$UUID" -r "$REALM" -s "secret=$HODNOTA" >/dev/null 2>&1 \
    || umri "$CID — zápis secretu selhal"

  # ⛔ ZPĚTNÉ PŘEČTENÍ. Některé verze Keycloaku update secretu TIŠE IGNORUJÍ
  # (doloženo v scripts/provision-sso.sh ř. 279–290). Bez ověření by smír
  # hlásil úspěch a konzumenti by dostávali invalid_client.
  PO="$($KCADM get "clients/$UUID/client-secret" -r "$REALM" --fields value --format csv --noquotes 2>/dev/null | head -1 || true)"
  [ "$PO" = "$HODNOTA" ] || umri "$CID — secret se NEULOŽIL (Keycloak drží jinou hodnotu). OIDC konzumenti by dostali invalid_client."

  log "  $CID — secret srovnán"
  zmeneno=$((zmeneno+1))
done

# ═══════════════════════════════════════════════════════════════════════════
# Servisní účty klientů, kterým je šablona deklaruje
# ═══════════════════════════════════════════════════════════════════════════
# ⛔ NAMĚŘENO 2026-09-07 na produkci <fork>: `netbird-backend`, `aisha-pki-issuer`
# a `aisha-user-admin` měly v živém realmu `serviceAccountsEnabled=false`,
# šablona říká `true`. Realm vznikl importem, který na 26.0.7 padal PRÁVĚ při
# zakládání servisních účtů (brána keycloak-verze-snese-servisni-ucty); po
# přechodu na 26.0.8 import existujícího klienta nepřepsal. Smír secretů hlásil
# „shoda", a přesto client_credentials končilo
#     401 unauthorized_client: Client not enabled to retrieve service account
# — fáze B bootstrapu stála u aisha-pki-issuer a mesh (netbird-backend) se
# neměl jak přihlásit. Secret bez zapnutého servisního účtu je klíč od dveří,
# které nejsou.
#
# Deklarace tedy konverguje i TENHLE příznak. Nic víc: servisního uživatele
# (`service-account-<clientId>`) založí Keycloak sám; smír na uživatele nesahá.
SA_KLIENTI="$(awk '
  match($0, /"clientId"[[:space:]]*:[[:space:]]*"[^"]+"/) {
    s = substr($0, RSTART, RLENGTH); gsub(/.*"clientId"[[:space:]]*:[[:space:]]*"/, "", s); gsub(/"$/, "", s)
    cid = s; next
  }
  /"serviceAccountsEnabled"[[:space:]]*:[[:space:]]*true/ { if (cid != "") { print cid; cid = "" } }
' "$SABLONA")"

[ -n "$SA_KLIENTI" ] || umri "šablona nedeklaruje ANI JEDNOHO klienta se servisním účtem — netbird-backend by se neměl jak přihlásit; tiše projít nesmí"

log "šablona deklaruje $(echo "$SA_KLIENTI" | wc -l | tr -d ' ') klientů se servisním účtem"
sa_zapnuto=0; sa_shodne=0
for CID in $SA_KLIENTI; do
  UUID="$($KCADM get clients -r "$REALM" -q "clientId=$CID" --fields id --format csv --noquotes 2>/dev/null | head -1 || true)"
  if [ -z "$UUID" ]; then
    log "  $CID — v realmu NENÍ, přeskakuji (klienta zakládá import, ne smír)"; continue
  fi
  STAV="$($KCADM get "clients/$UUID" -r "$REALM" --fields serviceAccountsEnabled --format csv --noquotes 2>/dev/null | head -1 || true)"
  if [ "$STAV" = "true" ]; then
    log "  $CID — servisní účet zapnutý, nic nedělám"; sa_shodne=$((sa_shodne+1)); continue
  fi
  $KCADM update "clients/$UUID" -r "$REALM" -s serviceAccountsEnabled=true >/dev/null 2>&1 \
    || umri "$CID — zapnutí servisního účtu selhalo"
  # ⛔ ZPĚTNÉ PŘEČTENÍ — táž zásada jako u secretu: update, který Keycloak tiše
  # ignoruje, by jinak vypadal jako úspěch a 401 by zůstalo.
  PO="$($KCADM get "clients/$UUID" -r "$REALM" --fields serviceAccountsEnabled --format csv --noquotes 2>/dev/null | head -1 || true)"
  [ "$PO" = "true" ] || umri "$CID — servisní účet se NEZAPNUL (Keycloak drží '$PO'). client_credentials by dál končilo 401 unauthorized_client."
  log "  $CID — servisní účet zapnut"
  sa_zapnuto=$((sa_zapnuto+1))
done
log "servisní účty: zapnuto $sa_zapnuto, shodných $sa_shodne"

# ── Role servisních účtů, které šablona deklaruje ───────────────────────────
# ⛔ NAMĚŘENO 2026-09-07 hned po zapnutí servisních účtů: uživatel
# `service-account-netbird-backend` vznikl BEZ rolí, které mu šablona deklaruje
# (`realm-management`: manage-users, view-users, query-users). NetBird management
# při validaci tokenu volá admin API (`users/count`) pod tímhle účtem → 403 →
# každý token „invalid". Zapnutý servisní účet bez rolí je klíč, který otevře
# dveře do prázdné místnosti. Import je přiděluje jen při ZALOŽENÍ účtu; smír
# je proto dorovnává. Jen deklarované `service-account-*` a jen klientské role
# `realm-management` — lidských uživatelů se to netýká.
SA_ROLE="$(awk '
  match($0, /"username"[[:space:]]*:[[:space:]]*"service-account-[^"]+"/) {
    s = substr($0, RSTART, RLENGTH); gsub(/.*"username"[[:space:]]*:[[:space:]]*"/, "", s); gsub(/"$/, "", s)
    su = s; inr = 0; next
  }
  su != "" && /"realm-management"[[:space:]]*:[[:space:]]*\[/ {
    inr = 1; rest = $0; sub(/.*\[/, "", rest)
    if (rest ~ /\]/) { sub(/\].*/, "", rest); inr = 0 }
    n = split(rest, a, ","); for (i = 1; i <= n; i++) { r = a[i]; gsub(/[[:space:]"]/, "", r); if (r != "") print su "\t" r }
    next
  }
  inr == 1 {
    line = $0; if (line ~ /\]/) { sub(/\].*/, "", line); inr = 0 }
    n = split(line, a, ","); for (i = 1; i <= n; i++) { r = a[i]; gsub(/[[:space:]"]/, "", r); if (r != "") print su "\t" r }
    next
  }
' "$SABLONA")"

role_pridano=0; role_shodne=0
if [ -n "$SA_ROLE" ]; then
  RM_UUID="$($KCADM get clients -r "$REALM" -q "clientId=realm-management" --fields id --format csv --noquotes 2>/dev/null | head -1 || true)"
  [ -n "$RM_UUID" ] || umri "klient realm-management v realmu není — role servisních účtů nemá kam viset"
  echo "$SA_ROLE" | while IFS="$(printf '\t')" read -r SU ROLE; do
    [ -n "$SU" ] && [ -n "$ROLE" ] || continue
    UID_S="$($KCADM get users -r "$REALM" -q "username=$SU" --fields id --format csv --noquotes 2>/dev/null | head -1 || true)"
    if [ -z "$UID_S" ]; then
      log "  $SU — v realmu NENÍ (servisní účet klienta vzniká zapnutím výš), přeskakuji roli $ROLE"; continue
    fi
    MA="$($KCADM get "users/$UID_S/role-mappings/clients/$RM_UUID" -r "$REALM" --fields name --format csv --noquotes 2>/dev/null | grep -cx "$ROLE" || true)"
    if [ "$MA" = "1" ]; then
      log "  $SU — role $ROLE už je"; continue
    fi
    $KCADM add-roles -r "$REALM" --uusername "$SU" --cclientid realm-management --rolename "$ROLE" >/dev/null 2>&1 \
      || umri "$SU — přidání role $ROLE selhalo"
    PO="$($KCADM get "users/$UID_S/role-mappings/clients/$RM_UUID" -r "$REALM" --fields name --format csv --noquotes 2>/dev/null | grep -cx "$ROLE" || true)"
    [ "$PO" = "1" ] || umri "$SU — role $ROLE se NEPŘIDALA (zpětné čtení ji nevidí). Admin API by dál vracelo 403."
    log "  $SU — role $ROLE přidána"
  done
fi
log "role servisních účtů srovnány podle šablony ($(echo "$SA_ROLE" | grep -c . ) deklarovaných dvojic)"

# ═══════════════════════════════════════════════════════════════════════════
# Hesla SERVISNÍCH účtů, které šablona deklaruje
# ═══════════════════════════════════════════════════════════════════════════
# ⛔ DRUHÁ POLOVINA TÉHOŽ PÁRU. `netbird-peer-discover` se přihlašuje přes ROPC
# (`grant_type=password`), takže potřebuje OBOJE: secret KLIENTA i heslo
# UŽIVATELE. Naměřeno 2026-09-05: šablona měla u `aisha-bootstrap`
# `"credentials": []`, tedy žádné heslo — a `AISHA_BOOTSTRAP_PASSWORD` přitom
# v .env.coolify celou dobu leželo. Oprava jen secretu by tedy nestačila:
# ROPC by padlo o krok dál a vypadalo by to jako úplně jiná vada.
#
# ⛔ UKAZATEL, NE HODNOTA. Šablona nese jen JMÉNO proměnné
# (`"aisha.passwordFrom": ["AISHA_BOOTSTRAP_PASSWORD"]`), nikdy heslo samo.
# Inline `"credentials": [{"value": "${VAR}"}]` by Pass 2 dosadila SKUTEČNÝM
# heslem a to by skončilo v souboru na disku kontejneru — a navíc by porušilo
# bránu netbird-account-owner, která u `aisha-bootstrap` inline credentials
# ZAKAZUJE (heslo se nastavuje dynamicky, viz její hlavička: service-account
# UUID jako vlastník účtu zacyklí NetBird IDP sync).
#
# Člověk (`__PLATFORM_ADMIN_*__`, Pass 1) ten atribut nemá, takže se sem nikdy
# nedostane — původní záruka „re-deploy nesmí přerazit admina, který si změnil
# heslo" platí beze změny.
UCTY="$(awk '
  match($0, /"username"[[:space:]]*:[[:space:]]*"[^"]+"/) {
    s = substr($0, RSTART, RLENGTH); gsub(/.*"username"[[:space:]]*:[[:space:]]*"/, "", s); gsub(/"$/, "", s)
    un = s; next
  }
  /"aisha\.passwordFrom"/ { hledam = 1; next }
  hledam && match($0, /"[A-Z_0-9]+"/) {
    s = substr($0, RSTART+1, RLENGTH-2)
    if (un != "") { print un "\t" s; un = "" }
    hledam = 0
  }
' "$SABLONA")"

if [ -z "$UCTY" ]; then
  log "šablona nedeklaruje heslo žádnému servisnímu účtu — nic k srovnání"
else
  log "šablona deklaruje heslo $(echo "$UCTY" | wc -l | tr -d ' ') servisním účtům"
  echo "$UCTY" | while IFS="$(printf '\t')" read -r UN VAR; do
    [ -n "$UN" ] || continue
    eval "HESLO_U=\${$VAR:-}"
    if [ -z "${HESLO_U:-}" ]; then
      log "  $UN — $VAR prázdná, PŘESKAKUJI"
      continue
    fi
    UID_U="$($KCADM get users -r "$REALM" -q "username=$UN" --fields id --format csv --noquotes 2>/dev/null | head -1 || true)"
    if [ -z "$UID_U" ]; then
      log "  $UN — v realmu NENÍ, přeskakuji (účet zakládá import, ne smír)"
      continue
    fi
    # Heslo se z Keycloaku PŘEČÍST NEDÁ (hash), takže se nastavuje vždy. Je to
    # idempotentní: tentýž vstup dá tentýž stav.
    #
    # ⛔ ŽÁDNÉ `--temporary false`. Naměřeno 2026-09-06 při prvním ostrém běhu:
    # `-t, --temporary` je PŘEPÍNAČ BEZ HODNOTY (kcadm set-password --help), takže
    # `false` se předalo jako další argument a příkaz skončil chybou. Trvalé heslo
    # se dostane tím, že se přepínač VYNECHÁ — dočasné by ROPC odmítlo
    # („Account is not fully set up“).
    #
    # Chybová hláška nese stderr, ne jen konstatování: „selhalo" bez důvodu mě
    # stálo jeden nasazovací cyklus.
    _chyba="$($KCADM set-password -r "$REALM" --userid "$UID_U" --new-password "$HESLO_U" 2>&1)" \
      || umri "$UN — nastavení hesla selhalo: $_chyba"
    log "  $UN — heslo srovnáno"
  done
fi

# ── Poskytovatelé identity (apple / google) ───────────────────────────────────
# ⛔ PROČ TADY, A NE JEN V `configure-realms.sh` (naměřeno 2026-09-20 na jedné
# instanci forku): přihlašovací stránka nabízela JEN Apple, ačkoli pověření pro
# Google byla v prostředí appky vyplněná. Příčina je stejná třída jako u klientů
# výš: 17. 9. se po ztrátě svazků realm naimportoval ZE ŠABLONY, kde jsou oba
# poskytovatelé `enabled:false` (a mají se zapnout až podle prostředí). Smír po
# startu ale srovnával jen KLIENTY, takže se Google už nikdy nezapnul; Apple
# někdo zapnul rukou. Po obnově tedy stav nedohnal deklaraci a nikdo to neměřil.
#
# `configure-realms.sh` tutéž věc umí, jenže běží z hostitele (curl + python3,
# které v tomhle obrazu nejsou) — tedy při cold startu a z ručních nástrojů.
# Restore ani redeploy ho nezavolá. Smír po startu je JEDINÉ místo, kterým
# projde každý start, takže patří sem.
#
# Pravidlo (stejné jako u configure-realms.sh, ať obě cesty dávají týž stav):
#   pověření v prostředí   → nastav a ZAPNI,
#   bez pověření, ale KC má clientId → NECH BÝT (přihlášení je živé, env o něm neví),
#   bez pověření a KC nemá clientId  → VYPNI (žádné mrtvé tlačítko na přihlášení).
#
# Secrety jdou do kcadm STDINEM (`-f -`), ne přes argv: `ps` uvnitř kontejneru
# by je jinak vydal komukoliv, kdo tam doběhne.

# Stav poskytovatele v realmu: stdout = reprezentace, PRÁZDNÉ = v realmu NENÍ.
# ⛔ CHYBA NÁSTROJE ≠ DATA. „Není" smí znamenat JEN 404 (kcadm 26.0.8 vypíše
# „Resource not found for url: …", rc 1 — naměřeno 2026-09-25 na dočasném KC).
# Vypršený token, 5xx nebo síť („Invalid user credentials", „HTTP error - 5xx",
# „Failed to send request") by se jinak tvářily jako chybějící poskytovatel:
# bez pověření v env tiché „přeskočen", s pověřením pád na `create` se
# zavádějící hláškou. Ostatní chyby proto končí smír. Výstup chyby je jen hláška
# kcadm (tělo odpovědi s maskovaným secretem jde na stdout jen při úspěchu).
idp_stav() {
  if _idp_vystup="$($KCADM get "identity-provider/instances/$1" -r "$REALM" 2>&1)"; then
    printf '%s' "$_idp_vystup"
    return 0
  fi
  case "$_idp_vystup" in
    *"Resource not found"*) return 0 ;;
  esac
  umri "IdP $1 — čtení z Keycloaku selhalo (ne 404, stav NEZNÁMÝ): $(printf '%s' "$_idp_vystup" | head -3)"
}

IDP_ZMENENO=0
for IDP_ALIAS in apple google; do
  case "$IDP_ALIAS" in
    apple)  IDP_CID="${OAUTH_APPLE_CLIENT_ID:-}";  IDP_SEC="${OAUTH_APPLE_CLIENT_SECRET:-}";  IDP_SCOPE="openid email name";    IDP_ORDER=2 ;;
    google) IDP_CID="${OAUTH_GOOGLE_CLIENT_ID:-}"; IDP_SEC="${OAUTH_GOOGLE_CLIENT_SECRET:-}"; IDP_SCOPE="openid email profile"; IDP_ORDER=1 ;;
  esac

  # umri v `$(…)` ukončí jen podshell — proto `|| exit 1` (hláška už je na stderr).
  IDP_STAV="$(idp_stav "$IDP_ALIAS")" || exit 1
  IDP_ZIVY_CID="$(printf '%s' "$IDP_STAV" | awk '
    match($0, /"clientId"[[:space:]]*:[[:space:]]*"[^"]*"/) {
      s = substr($0, RSTART, RLENGTH); gsub(/.*"clientId"[[:space:]]*:[[:space:]]*"/, "", s); gsub(/"$/, "", s)
      print s; exit
    }')"

  if [ -z "$IDP_CID" ] || [ -z "$IDP_SEC" ]; then
    if [ -n "$IDP_STAV" ] && [ -n "$IDP_ZIVY_CID" ]; then
      log "  IdP $IDP_ALIAS — bez pověření v prostředí, ale v realmu nakonfigurovaný: ponechán"
    elif [ -n "$IDP_STAV" ]; then
      $KCADM update "identity-provider/instances/$IDP_ALIAS" -r "$REALM" -s enabled=false >/dev/null 2>&1 \
        && { log "  IdP $IDP_ALIAS — bez pověření v prostředí i v realmu: vypnut"; IDP_ZMENENO=$((IDP_ZMENENO + 1)); } \
        || log "  ⚠ IdP $IDP_ALIAS — vypnutí selhalo"
    else
      log "  IdP $IDP_ALIAS — bez pověření a v realmu není: přeskočen"
    fi
    continue
  fi

  # Escapování do JSON: zpětné lomítko a uvozovka. Hodnoty jsou base64url,
  # reverzní doména nebo podepsaný JWT — jiné znaky se v nich nevyskytují,
  # ale escapovat se MUSÍ, jinak by jedna uvozovka rozbila celý dokument.
  IDP_CID_J="$(printf '%s' "$IDP_CID" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  IDP_SEC_J="$(printf '%s' "$IDP_SEC" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

  if [ -n "$IDP_STAV" ]; then
    # `update` mění JEN vyjmenovaná pole. Načíst a zapsat zpátky celou
    # reprezentaci by přepsalo secret literálem `**********` — Keycloak ho
    # vydává maskovaný (naměřeno 2026-08-04 na produkci: skutečné heslo
    # neexistuje nikde jinde a API ho nevydá).
    # ⛔ `-m` JE NOSNÉ (naměřeno 2026-09-25 na dočasném KC 26.0.8): se `--file`
    # kcadm ve výchozím stavu NESLUČUJE („Merge is automatically enabled unless
    # --file is specified") → tenhle částečný dokument by šel jako celý PUT
    # a KC ho odmítne („Invalid identity provider id [null]"). S `-m` se sloučí
    # s GET do hloubky: klíče configu navíc přežijí (Apple teamId/keyId/p8Key,
    # Google guiOrder/prompt/hostedDomain), secret se zapíše. S `--no-merge`
    # by PUT nahradil CELÝ config.
    printf '{"enabled":true,"config":{"clientId":"%s","clientSecret":"%s","defaultScope":"%s"}}' \
      "$IDP_CID_J" "$IDP_SEC_J" "$IDP_SCOPE" \
      | $KCADM update "identity-provider/instances/$IDP_ALIAS" -r "$REALM" -m -f - >/dev/null 2>&1 \
      && { log "  IdP $IDP_ALIAS — srovnán z prostředí a zapnut"; IDP_ZMENENO=$((IDP_ZMENENO + 1)); } \
      || umri "IdP $IDP_ALIAS — srovnání selhalo (kcadm update)"
  else
    printf '{"alias":"%s","displayName":"%s","providerId":"%s","enabled":true,"trustEmail":true,"storeToken":false,"linkOnly":false,"firstBrokerLoginFlowAlias":"aisha first broker login","config":{"clientId":"%s","clientSecret":"%s","defaultScope":"%s","syncMode":"IMPORT","guiOrder":"%s","useJwksUrl":"true"}}' \
      "$IDP_ALIAS" "$IDP_ALIAS" "$IDP_ALIAS" "$IDP_CID_J" "$IDP_SEC_J" "$IDP_SCOPE" "$IDP_ORDER" \
      | $KCADM create identity-provider/instances -r "$REALM" -f - >/dev/null 2>&1 \
      && { log "  IdP $IDP_ALIAS — založen z prostředí a zapnut"; IDP_ZMENENO=$((IDP_ZMENENO + 1)); } \
      || umri "IdP $IDP_ALIAS — založení selhalo (kcadm create)"
  fi
done
log "poskytovatelé identity: změněno $IDP_ZMENENO"

# >>> tok-prvniho-prihlaseni
# ── Tok prvního přihlášení přes vnější IdP: ŽÁDNÉ automatické propojení ──────
# ⛔ NAMĚŘENO 2026-09-27 (Aisha Guru, SELECT nad DB Keycloaku čtyř instancí se
# zapnutým Google/Apple): v ŽIVÉM realmu všude `idp-auto-link` v toku
# „aisha handle existing user". Kdo se přihlásí Googlem/Applem s e-mailem
# EXISTUJÍCÍHO účtu, propojí se s ním bez jakéhokoli ověření — správce e-mailové
# domény tak převezme účty s adresou v ní. `IdpAutoLinkAuthenticator` (KC 26.0.8)
# nastaví existujícího uživatele a hned `success()`; na trustEmail ani na
# email_verified nehledí.
#
# Šablona to opravila, ale tok se do realmu dostane jen IMPORTEM do prázdného
# realmu — běžící realm by opravu nikdy neviděl. Proto se srovnává tady, při
# KAŽDÉM startu, stejně jako klienti a poskytovatelé výš.
#
# Místo automatiky: potvrzení propojení + POVINNÉ ověření vlastníka — odkaz
# e-mailem (bez SMTP vrátí `attempted` a tok jde dál) NEBO znovu heslem
# (a OTP, má-li ho účet). Účet bez hesla na instanci bez SMTP se tudy poprvé
# nepropojí — pro něj je krok B (schválení v administraci).
#
# Staví se VŽDY NAČISTO (rozdělaný podtok z přerušeného běhu se nejdřív zahodí)
# a automatika odchází až ve chvíli, kdy je ověření celé na místě. Výsledek se
# MĚŘÍ novým čtením toku, ne návratovým kódem kcadm.
TOK_EXISTUJICI="aisha handle existing user"
TOK_OVERENI="aisha existing account verification"
TOK_MOZNOSTI="aisha account verification options"
TOK_HESLO="aisha verify by reauthentication"
TOK_OTP="aisha first broker conditional otp"

tok_cesta() { printf 'authentication/flows/%s' "$(printf '%s' "$1" | sed 's/ /%20/g')"; }

# Kroky toku, rekurzivně (KC je vrací zploštěle): řádky „id,providerId,displayName,requirement".
# PRÁZDNÉ = tok v realmu není (jen 404); jiná chyba nástroje smír ukončí.
tok_kroky() {
  if _tk="$($KCADM get "$(tok_cesta "$1")/executions" -r "$REALM" --fields id,providerId,displayName,requirement --format csv --noquotes 2>&1)"; then
    printf '%s\n' "$_tk"
    return 0
  fi
  case "$_tk" in
    *"Resource not found"*) return 0 ;;
  esac
  umri "tok '$1' — čtení z Keycloaku selhalo (ne 404, stav NEZNÁMÝ): $(printf '%s' "$_tk" | head -3)"
}

# ⛔ PRIORITA SE POSÍLÁ VŽDY (KC 26.0.8, AuthenticationManagementResource.updateExecutions):
# `priority` je v reprezentaci `int` — PUT bez ní krok přeřadí na prioritu 0, tedy
# na ZAČÁTEK toku. Naměřeno 2026-09-27 na dočasném KC: podtok ověření skončil před
# „Create User If Unique" a nový uživatel by nejdřív narazil na propojení cizího
# účtu. Priority proto kopírují šablonu (10, 20).
nastav_pozadavek() {
  printf '{"id":"%s","requirement":"%s","priority":%s}' "$2" "$3" "$4" \
    | $KCADM update "$(tok_cesta "$1")/executions" -r "$REALM" -f - >/dev/null 2>&1 \
    || umri "tok '$1' — nastavení $3/$4 kroku $2 selhalo (kcadm update)"
}

pridej_krok() {
  if ! _pk="$($KCADM create "$(tok_cesta "$1")/executions/execution" -r "$REALM" -s provider="$2" -s priority="$4" -i 2>&1)"; then
    umri "tok '$1' — přidání kroku $2 selhalo: $(printf '%s' "$_pk" | head -2)"
  fi
  nastav_pozadavek "$1" "$_pk" "$3" "$4"
}

pridej_podtok() {
  $KCADM create "$(tok_cesta "$1")/executions/flow" -r "$REALM" \
    -s alias="$2" -s type=basic-flow -s provider=registration-page-form -s description="$3" -s priority="$5" >/dev/null 2>&1 \
    || umri "tok '$1' — přidání podtoku '$2' selhalo (kcadm create)"
  _pp="$(tok_kroky "$1" | awk -F, -v a="$2" '$2=="" && $3==a {print $1; exit}')"
  [ -n "$_pp" ] || umri "tok '$1' — podtok '$2' po založení nenalezen"
  nastav_pozadavek "$1" "$_pp" "$4" "$5"
}

# U ALTERNATIVE rozhoduje pořadí a KC řadí JEN podle priority (ExecutionComparator:
# rozdíl priorit; shoda = pořadí z DB, tedy náhoda). „Create User If Unique" proto
# musí mít mezi přímými kroky OSTŘE nejnižší prioritu — nestačí, že je zrovna první.
poradi_v_poradku() {
  if ! _pk0="$($KCADM get "$(tok_cesta "$TOK_EXISTUJICI")/executions" -r "$REALM" --fields level,priority,providerId --format csv --noquotes 2>&1)"; then
    umri "tok '$TOK_EXISTUJICI' — čtení pořadí z Keycloaku selhalo: $(printf '%s' "$_pk0" | head -3)"
  fi
  printf '%s\n' "$_pk0" | awk -F, '
    $1 == "0" { n++; if (n == 1) { p = $2 + 0; ok = ($3 == "idp-create-user-if-unique") } else if ($2 + 0 <= p) ok = 0 }
    END { exit !(n > 0 && ok) }'
}

# Jinak nový uživatel narazí na potvrzení propojení cizího účtu. Realm s prioritami 0
# (běh bez priority) se srovná výslovnými prioritami šablony; výsledek se MĚŘÍ znovu.
srovnej_poradi() {
  poradi_v_poradku && return 0
  _kr="$(tok_kroky "$TOK_EXISTUJICI")"
  _cid="$(printf '%s\n' "$_kr" | awk -F, '$2=="idp-create-user-if-unique" {print $1; exit}')"
  _vid="$(printf '%s\n' "$_kr" | awk -F, -v a="$TOK_OVERENI" '$2=="" && $3==a {print $1; exit}')"
  [ -n "$_cid" ] && [ -n "$_vid" ] || umri "tok prvního přihlášení — chybí založení uživatele nebo podtok ověření, pořadí nejde srovnat"
  nastav_pozadavek "$TOK_EXISTUJICI" "$_cid" ALTERNATIVE 10
  nastav_pozadavek "$TOK_EXISTUJICI" "$_vid" ALTERNATIVE 20
  poradi_v_poradku || umri "tok prvního přihlášení — založení nového uživatele se nepodařilo dostat na první místo"
  log "tok prvního přihlášení: založení nového uživatele vráceno na první místo"
}

srovnej_tok_prvniho_prihlaseni() {
  _kroky="$(tok_kroky "$TOK_EXISTUJICI")"
  if [ -z "$_kroky" ]; then
    log "tok prvního přihlášení: '$TOK_EXISTUJICI' v realmu není — přeskočen"
    return 0
  fi
  _auto="$(printf '%s\n' "$_kroky" | awk -F, '$2=="idp-auto-link" {print $1; exit}')"
  if [ -z "$_auto" ]; then
    if printf '%s\n' "$_kroky" | grep -q ',idp-confirm-link,'; then
      srovnej_poradi
    fi
    log "tok prvního přihlášení: bez automatického propojení (idp-auto-link v toku není)"
    return 0
  fi
  log "tok prvního přihlášení: nalezeno idp-auto-link — nahrazuji potvrzením a ověřením vlastníka"
  _stary="$(printf '%s\n' "$_kroky" | awk -F, -v a="$TOK_OVERENI" '$2=="" && $3==a {print $1; exit}')"
  if [ -n "$_stary" ]; then
    $KCADM delete "authentication/executions/$_stary" -r "$REALM" >/dev/null 2>&1 \
      || umri "tok prvního přihlášení — rozdělaný podtok z minula nejde smazat"
  fi
  pridej_podtok "$TOK_EXISTUJICI" "$TOK_OVERENI" "Existing account: the owner confirms the link, then proves ownership (e-mail or password)." ALTERNATIVE 20
  pridej_krok "$TOK_OVERENI" idp-confirm-link REQUIRED 10
  pridej_podtok "$TOK_OVERENI" "$TOK_MOZNOSTI" "Prove ownership of the existing account: e-mail link (needs realm SMTP) or re-authentication with its password." REQUIRED 20
  pridej_krok "$TOK_MOZNOSTI" idp-email-verification ALTERNATIVE 10
  pridej_podtok "$TOK_MOZNOSTI" "$TOK_HESLO" "Re-authenticate the existing account with its password (and OTP when configured)." ALTERNATIVE 20
  pridej_krok "$TOK_HESLO" idp-username-password-form REQUIRED 10
  pridej_podtok "$TOK_HESLO" "$TOK_OTP" "OTP when the existing account has it configured." CONDITIONAL 20
  pridej_krok "$TOK_OTP" conditional-user-configured REQUIRED 10
  pridej_krok "$TOK_OTP" auth-otp-form REQUIRED 20
  $KCADM delete "authentication/executions/$_auto" -r "$REALM" >/dev/null 2>&1 \
    || umri "tok prvního přihlášení — idp-auto-link nejde smazat (ověření je na místě, automatika zůstala)"
  srovnej_poradi
  _po="$(tok_kroky "$TOK_EXISTUJICI")"
  if printf '%s\n' "$_po" | grep -q ',idp-auto-link,'; then
    umri "tok prvního přihlášení — po srovnání je v něm pořád idp-auto-link"
  fi
  if ! printf '%s\n' "$_po" | grep -q ',idp-confirm-link,'; then
    umri "tok prvního přihlášení — po srovnání v něm chybí potvrzení propojení"
  fi
  log "tok prvního přihlášení: srovnán (potvrzení + ověření e-mailem nebo heslem)"
}
# <<< tok-prvniho-prihlaseni

srovnej_tok_prvniho_prihlaseni

log "hotovo"
