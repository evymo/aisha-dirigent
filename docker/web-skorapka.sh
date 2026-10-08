#!/bin/sh
# Pošle SPA skořápku (index.html TOHOTO buildu) web-renderu — `PUT /shell`
# přímo meshem (varianta d-ii). Spouští ho web-start.sh, a to JEN když se
# postavila routa do meshe a cíl prošel kontrolou tvaru (WEB_RENDER_CIL).
#
# Proč tlačí web: web a web-render jsou dvě Coolify aplikace a disk nesdílí;
# stažení přes veřejnou adresu by po zamčení dveří na Edge neprošlo. Skořápka
# z běžícího buildu = stránky odkazují na chunky, které web opravdu servíruje.
#
# Token NEJDE v argumentech procesu: curl ho čte jako konfiguraci ze stdin
# (`-K -`), takže není vidět v `ps` ani v /proc/<pid>/cmdline. Jméno cíle se
# překládá PŘÍMO mesh DNS (`--dns-servers`, WEB_RENDER_DNS od web-start.sh),
# ne vestavěným DNS Dockeru, které by dalo přednost aliasu ze sdílené sítě.
#
# Běží na pozadí vedle nginx a NIKDY ho neshodí. Opakuje s narůstající
# prodlevou, dokud web-render nepřijme (web se nasazuje dřív, web-render může
# čekat na konvergenci instance); po úspěchu posílá jednou za hodinu znovu —
# kdyby web-render přišel o svůj svazek, dostane skořápku zpět bez restartu webu.
# Stejná skořápka = žádné přegenerování.
set -u
cil="${WEB_RENDER_CIL:-}"
dns="${WEB_RENDER_DNS:-}"
token="${WEB_RENDER_SHELL_TOKEN:-}"
soubor=/usr/share/nginx/html/index.html
if [ -z "$cil" ] || [ -z "$token" ] || [ -z "$dns" ]; then
  echo "[skořápka] cíl nebo WEB_RENDER_SHELL_TOKEN chybí — web-render skořápku nedostane, web servíruje SPA (dorovnej instanci: cold-start --skip-create)" >&2
  exit 0
fi
case "$token" in
  *[!A-Za-z0-9._~+/=-]*)
    echo "[skořápka] WEB_RENDER_SHELL_TOKEN má neočekávané znaky — neposílám" >&2
    exit 0
    ;;
esac
prodleva=5
while :; do
  kod=$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -s -K - -o /dev/null -w '%{http_code}' \
    --dns-servers "$dns" --max-time 20 -X PUT -H 'Content-Type: text/html' --data-binary "@${soubor}" "${cil}/shell" 2>/dev/null) || kod=000
  case "$kod" in
    204)
      echo "[skořápka] web-render přijal skořápku tohoto buildu"
      prodleva=5
      sleep 3600
      continue
      ;;
    401|403|422)
      # Trvalé (token nebo rozbitá skořápka) — opakovat dokola nemá smysl, ale
      # musí to být VIDĚT: bez skořápky předrender nevznikne.
      echo "[skořápka] web-render skořápku ODMÍTL (HTTP ${kod}) — zkontroluj WEB_RENDER_SHELL_TOKEN / build; zkusím znovu za hodinu" >&2
      sleep 3600
      continue
      ;;
    503)
      echo "[skořápka] web-render skořápku zatím nepřijímá (HTTP 503 — jeho token nedoručen, čeká na konvergenci) — znovu za ${prodleva}s" >&2
      ;;
    *)
      echo "[skořápka] web-render nedostupný (HTTP ${kod}) — znovu za ${prodleva}s"
      ;;
  esac
  sleep "$prodleva"
  [ "$prodleva" -lt 300 ] && prodleva=$((prodleva * 2))
done
