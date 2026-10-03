#!/bin/sh
# mesh-client-route.sh — JEDINÝ DOMOV toho, jak se klient v edge stacku dostane
# do mesh sítě. Spouští ho každá služba edge stacku, která volá vnitřní jméno
# (edge-proxy, extranet-auth), jako první krok svého entrypointu.
#
# ⛔ PROČ VZNIKL (naměřeno 2026-08-21 na produkci).
#
# Edge do mesh chodil PŘES DNAT DVOU PEVNÝCH PORTŮ na mesh-routeru:
#
#     reverse_proxy http://<prefix>-mesh-router:3001   → DNAT → ${CORE_MESH_IP}:3001
#     reverse_proxy http://<prefix>-mesh-router:8080   → DNAT → ${CORE_MESH_IP}:8080
#
# To fungovalo, dokud byl v mesh JEDEN cíl (jádro). Jakmile do mesh vstoupily
# další stacky, vada se ukázala ve dvou tvarech naráz:
#
#   1. DNAT klíčuje POUZE PORTEM. Port 8080 má jádro (imgproxy) i n8n stack,
#      takže veřejný provoz `mcp`/`dirigent` skončil na imgproxy jádra a vrátil
#      `421 mesh-ingress: Host nepatri na tento port`. Port není adresa.
#   2. Kdo neměl mesh-router port, dostal v derivaci `https://<mesh jméno>` —
#      jenže jméno bez cesty NENÍ cesta: edge v mesh není, jméno propadlo přes
#      wildcard vyhledávací domény na sdílenou veřejnou IP a vrátilo se
#      `x509: certificate is valid for *.evymo.com` (502 na ingest/potok/live/
#      companion i na extranetu po přihlášení).
#
# TVAR OD 2026-08-21: klient má ROUTU do rozsahu peerů přes mesh-router a míří
# JMÉNEM na port služby. Rozlišuje se HOSTEM (mesh-ingress cíle), ne portem, a
# jméno má v mesh DNS záznam (netbird-dns-provision). Mesh-router zůstal tím, čím
# být má — hop, ne cíl: forwarduje, MASQUERADuje a klampuje MSS.
#
# ⛔ ŽÁDNÝ ÚSTUP. Když je mesh vyhlášená a routa se nepostaví, služba SKONČÍ.
# Tiché pokračování by znamenalo, že se vnitřní jméno zase přeloží wildcardem
# na cizí stroj — tedy že provoz odejde ven místo dovnitř. Výpadek je lepší.
set -eu

# ⛔ TENHLE SOUBOR SE NEMOUNTUJE. Je KANONICKÝM ZNĚNÍM, které se vkládá doslova
# do entrypointů `edge-proxy` a `extranet-auth` v docker-compose.coolify-prebuilt.yml
# (tam s compose-escapovaným `$` → `$$`). Bind mount z repa byl první pokus a
# NEFUNGUJE: Coolify staví edge na build serveru a na cílovém uzlu repo nemá,
# takže zdroj mountu neexistoval, Docker místo souboru vytvořil ADRESÁŘ a
# edge-proxy skončil v restart smyčce (`exit 126: Permission denied`) —
# veřejná plocha byla kvůli tomu dole (2026-08-21).
# Shodu obou kopií s tímhle souborem hlídá brána `mesh-lane-miri-jmenem-ne-hopem`.

_mesh="$(echo "${MESH_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')"
case "$_mesh" in
  true|1|yes|on)
    if [ -z "${NETBIRD_PEER_CIDR:-}" ] || [ -z "${NETBIRD_DNS_IP:-}" ]; then
      echo "[mesh-route] FATAL: mesh je vyhlášená, ale chybí NETBIRD_PEER_CIDR nebo NETBIRD_DNS_IP." >&2
      exit 64
    fi
    if ip route replace "${NETBIRD_PEER_CIDR}" via "${NETBIRD_DNS_IP}" 2>&1; then
      echo "[mesh-route] routa ${NETBIRD_PEER_CIDR} → ${NETBIRD_DNS_IP} (mesh-router) postavena"
    else
      echo "[mesh-route] FATAL: routu do mesh nelze postavit — chybí NET_ADMIN, nebo služba není na síti mesh-dns." >&2
      echo "[mesh-route] NEDĚLEJ: nepokračuj bez routy — vnitřní jméno by se přeložilo wildcardem VEN." >&2
      exit 64
    fi
    ;;
  *)
    echo "[mesh-route] MESH_ENABLED=${MESH_ENABLED:-<unset>} — routa do mesh se nestaví (veřejná lane)."
    ;;
esac

# Brána je PINOVANÁ adresa mesh-routeru na síti mesh-dns (generate-secrets ji
# odvozuje z MESH_DNS_SUBNET a compose ji mesh-routeru přiděluje jako
# ipv4_address). Proto se nikam nekouká přes DNS: adresa je vlastnost návrhu,
# ne nález. Rozsah peerů je konstanta NetBirdu (scripts/lib/derive-subnets.mjs).
if [ -z "${NETBIRD_PEER_CIDR:-}" ] || [ -z "${NETBIRD_DNS_IP:-}" ]; then
  echo "[mesh-route] FATAL: mesh je vyhlášená, ale chybí NETBIRD_PEER_CIDR nebo NETBIRD_DNS_IP." >&2
  echo "[mesh-route] Obojí vydává generate-secrets a doručuje coolify-deploy-init.sh." >&2
  exit 64
fi

if ip route replace "${NETBIRD_PEER_CIDR}" via "${NETBIRD_DNS_IP}" 2>&1; then
  echo "[mesh-route] routa ${NETBIRD_PEER_CIDR} → ${NETBIRD_DNS_IP} (mesh-router) postavena"
else
  echo "[mesh-route] FATAL: routu do mesh nelze postavit (${NETBIRD_PEER_CIDR} via ${NETBIRD_DNS_IP})." >&2
  echo "[mesh-route] Nejčastěji chybí cap_add NET_ADMIN nebo služba není na síti mesh-dns." >&2
  echo "[mesh-route] NEDĚLEJ: nepokračuj bez routy — vnitřní jméno by se přeložilo wildcardem" >&2
  echo "[mesh-route]          na cizí stroj a provoz by odešel VEN místo dovnitř." >&2
  exit 64
fi
