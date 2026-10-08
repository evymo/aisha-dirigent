#!/bin/sh
# Start kontejneru `web` (varianta d-ii, rozhodnutí majitele 2026-10-02).
#
# Předrenderované stránky si web TÁHNE z web-renderu přímo MESHEM a skořápku mu
# tamtéž POŠLE. Žádný relay na sdílené síti (dřívější posluchač edge-proxy :8091
# byl dosažitelný z `coolify` sítě ostatních nájemníků — nález revize 2026-10-02).
#
# 1. Routa do rozsahu peerů — DOSLOVNÁ kopie jádra infra/mesh/mesh-client-route.sh
#    (shodu hlídá brána mesh-lane-miri-jmenem-ne-hopem). Běží v SUBSHELLU: jeho
#    `exit 64` tu nevypne celý web (veřejná tvář), jen PŘEDRENDER. Bez routy by
#    se mesh jméno mohlo přeložit wildcardem na cizí stroj a token skořápky
#    i stránky by šly ven — proto se v tom případě předrender NEZAPNE (fail-closed),
#    web servíruje SPA jako dosud. MESH_ENABLED compose deklaruje povinně (`:?`),
#    proto tu bez `:-` (brána zadny-fallback-nad-identitou; s `set -u` chybějící
#    hodnota shodí jen subshell → předrender vypnutý).
# 2. Cíl z derivace (WEB_RENDER_UPSTREAM_MESH = `http://<jméno>:<port>`) se zapíše
#    do include souborů nginx — nginx prostředí nečte. Přijme se JEN tento tvar;
#    cokoli jiného (i prázdno, i víc řádků) = předrender vypnutý.
# 3. Otisk skořápky TOHOTO buildu (sha256 index.html, 16 hex — týž výpočet jako
#    web-render) jde s každým dotazem: web-render nevydá stránku z jiné skořápky.
set -eu

zapnuto=0
host=""
cil="${WEB_RENDER_UPSTREAM_MESH:-}"

if [ -n "$cil" ]; then
  if (
  _mesh="$(echo "${MESH_ENABLED}" | tr '[:upper:]' '[:lower:]')"
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
      echo "[mesh-route] MESH_ENABLED=${MESH_ENABLED} — routa do mesh se nestaví (veřejná lane)."
      ;;
  esac
  ); then
    zbytek="${cil#http://}"
    host="${zbytek%:*}"
    port="${zbytek##*:}"
    case "$cil" in
      http://*) ;;
      *) host="" ;;
    esac
    case "$host" in
      ""|*[!A-Za-z0-9.-]*) host="" ;;
    esac
    case "$port" in
      ""|*[!0-9]*) host="" ;;
    esac
    # Resolver = PŘÍMO mesh DNS (NETBIRD_DNS_IP), ne vestavěné DNS Dockeru
    # (127.0.0.11): to PŘEDNOSTNĚ vrací aliasy ze sítí kontejneru, včetně sdílené
    # `coolify`, takže cizí kontejner s aliasem `<prefix>-web-render.mesh.<tld>`
    # by mesh jméno přebil (revize RIQi Detail firmy, kolo 2, ověřeno lokálně).
    # Jen tvar IPv4 — hodnota jde do konfigurace nginx.
    dns="${NETBIRD_DNS_IP:-}"
    case "$dns" in
      ""|*[!0-9.]*|.*|*.|*..*) dns="" ;;
    esac
    if [ -n "$host" ] && [ "$zbytek" = "${host}:${port}" ] && [ -n "$dns" ]; then
      zapnuto=1
    elif [ -z "$dns" ]; then
      echo "[web] NETBIRD_DNS_IP chybí nebo nemá tvar IPv4 — předrender vypnutý, servíruje SPA" >&2
    else
      echo "[web] WEB_RENDER_UPSTREAM_MESH má neočekávaný tvar — předrender vypnutý, servíruje SPA" >&2
    fi
  else
    echo "[web] routa do meshe se nepostavila — předrender VYPNUTÝ (fail-closed), web servíruje SPA" >&2
  fi
fi

if [ "$zapnuto" = 1 ]; then
  printf 'upstream web_render {\n  zone web_render 64k;\n  resolver %s valid=10s ipv6=off;\n  server %s:%s resolve;\n  keepalive 16;\n}\n' "$dns" "$host" "$port" \
    > /etc/nginx/web-render-upstream.conf
else
  printf 'upstream web_render {\n  server 127.0.0.1:9 down;\n}\n' > /etc/nginx/web-render-upstream.conf
fi
otisk="$(sha256sum /usr/share/nginx/html/index.html | cut -c1-16)"
printf 'set $web_render_zapnuto "%s";\nset $web_render_host "%s";\nset $skorapka_otisk "%s";\n' \
  "$zapnuto" "${host:+${host}:${port}}" "$otisk" > /etc/nginx/web-render-cil.conf

if [ "$zapnuto" = 1 ]; then
  # Přes `sh`, ne přímo: na bitu `x` nezáleží (připojený soubor ho mít nemusí).
  WEB_RENDER_CIL="$cil" WEB_RENDER_DNS="$dns" sh /usr/local/bin/web-skorapka.sh &
fi
exec nginx -g 'daemon off;'
