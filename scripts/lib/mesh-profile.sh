# shellcheck shell=bash
# mesh-profile.sh — profil `mesh` v COMPOSE_PROFILES. Jediný domov pravidla.
#
# Mesh komponenty (netbird-agent, *-mesh-ingress, *-mesh-tcp) nesou v compose
# `profiles: ["mesh"]` a nespustí se, dokud mesh nestojí. Bez směrovací tabulky
# naslouchá mesh-ingress na :8000 a vrací 503 („aby bylo VIDĚT, že tabulka
# chybí"), kdežto healthcheck se ptá na servisní port — na profilu BEZ meshe je
# tedy prázdná tabulka správný stav a trvalé unhealthy jen šum (naměřeno
# 2026-09-04, admin + ai-chat, FailingStreak 776).
#
# Zapínají ho DVĚ roviny a obě musí mluvit stejně:
#   · coolify-deploy-init.sh  — při zakládání a cold-startu
#   · coolify-sync-envs.sh    — před KAŽDÝM vlnovým nasazením (aisha-redeploy)
#
# ⛔ NAMĚŘENO 2026-09-13 na nasazeném forku: `COMPOSE_PROFILES` neměla ANI JEDNA
# z 34 aplikací. Staré kontejnery mesh sidecary nesly z dřívějška, takže to
# nebylo vidět — první redeploy core naběhl bez `netbird-agent` a
# `core-mesh-ingress`, edge hlásil `dial tcp <mesh-ip>:3001: no route to host`
# a veřejné API vracelo 502. Vlnová rovina profil nepsala vůbec a úklid
# `PRUNE_EXTRA` ho mazal, protože na `COMPOSE_PROFILES` compose nikdy neodkazuje
# jako na `${…}` — čte ho docker compose sám z `.env`.

# Klíče, které čte docker compose SÁM z `.env` projektu. Compose na ně nikdy
# neodkazuje jako na `${…}`, takže je odvození payloadu z compose nevidí —
# a úklid proměnných „bez odkazu" je nesmí smazat.
MESH_PROFILE_RIDICI_KLICE_COMPOSE="COMPOSE_PROFILES"

# ⚠ SLOUČIT, NEPŘEPSAT. Tři aplikace (edge, matrix, domain-services) si
# COMPOSE_PROFILES nastavují samy; prosté přiřazení by jim profil sebralo a
# `knock`/bridge by tiše zmizely — přesně ta třída vady, před kterou varuje
# komentář u edge profilů („tichý přeskok by vyrobil stack, kde vrátný prostě
# není, a nikde by nestálo proč").
mesh_profile_merge() {
  # ⚠ DVĚ `local` PŘIŘAZENÍ, NE JEDNO. `local a="$1" b="$a"` čte `a` dřív, než ho
  # založí, takže `b` vyjde PRÁZDNÉ — a protože se přepisuje jen ve větvi, která
  # mesh přidává, prošly by testy „mesh zapnutý" a tiše by zmizel profil ve
  # zbylých dvou případech. Naměřeno při psaní tohohle pomocníka.
  # Bez `${…:-}`: brána zadny-fallback-nad-identitou je rohatka, která smí jen
  # KLESAT, a fallback tu není potřeba — všechna volání argument předávají a
  # MESH_ENABLED volající čte bez fallbacku.
  local vlastni="$1"
  local vysledek="$vlastni"
  if [ "$MESH_ENABLED" = "true" ]; then
    vysledek="$(profil_sluc "$vlastni" mesh)"
  fi
  printf '%s' "$vysledek"
}

# profil_sluc <csv> <jméno> — přidá profil, pokud v seznamu ještě není. Pořadí
# a ostatní profily zůstanou. Jediný zápis pravidla „sloučit, nepřepsat".
profil_sluc() {
  local csv="$1"
  local jmeno="$2"
  case ",${csv}," in
    *,"${jmeno}",*) printf '%s' "$csv" ;;
    *) printf '%s' "${csv:+${csv},}${jmeno}" ;;
  esac
}

# profil_bez <csv> <jméno> — odebere profil, ostatní zůstanou v pořadí.
profil_bez() {
  local csv="$1"
  local jmeno="$2"
  local vysledek=""
  local p
  local IFS=","
  for p in $csv; do
    [ -n "$p" ] || continue
    [ "$p" = "$jmeno" ] && continue
    vysledek="${vysledek:+${vysledek},}${p}"
  done
  printf '%s' "$vysledek"
}

# edge_compose_profily <deklarace EDGE_COMPOSE_PROFILES> <AISHA_SURFACES>
#
# ⛔ NAMĚŘENO 2026-09-15: deploy-init skládal profily edge tak, že deklarace
# (`EDGE_COMPOSE_PROFILES`) a odvozené profily se VYLUČOVALY přes `[[ -z … ]]` —
# instance, která deklarovala `knock`, tím ztratila `extranet-gate` (a extranet
# vracel 404), a instance BEZ deklarace dostala `knock`, jakmile ležel roster.
# Dveře zapíná JEN deklarace (lib/dvere-soulad.mjs); `extranet-gate` plyne
# z vyhlášeného povrchu. Obojí se SLUČUJE.
edge_compose_profily() {
  local vysledek="$1"
  case "$2" in
    *extranet*) vysledek="$(profil_sluc "$vysledek" extranet-gate)" ;;
  esac
  printf '%s' "$vysledek"
}

# compose_ma_profil_dveri <compose> — nese compose dveře (`profiles: ["knock"]`)?
# Jen taková aplikace (edge) má profil dveří srovnávat s deklarací instance.
compose_ma_profil_dveri() {
  local compose="$1"
  [ -f "$compose" ] || return 1
  grep -qE '^[[:space:]]{4}profiles:.*"knock"' "$compose"
}

# compose_ma_mesh_profil <compose> — deklaruje compose aspoň jednu službu
# s profilem `mesh`? Aplikaci bez takové služby profil nepřidáváme: nic by
# nerozsvítil a jen by šuměl v rozdílech (edge má vlastní profily, mesh ne).
compose_ma_mesh_profil() {
  local compose="$1"
  [ -f "$compose" ] || return 1
  grep -qE '^[[:space:]]{4}profiles:.*"mesh"' "$compose"
}
