#!/bin/bash
# =============================================================================
# edge-uklid-e2e.sh — úklid evidence adres změřený V OBRAZU edge (caddy:2.8.4-alpine)
# =============================================================================
# Brána `evidence-adres-drzi-lhutu` spouští úsek příkazu edge v sh hostitele.
# To nestačí na tři věci, které rozhoduje až obraz: busybox (find -mmin,
# timeout, touch -d), zapisovač logu Caddy (lumberjack) a Docker jako
# vykonavatel healthchecku. Tenhle skript je měří: vyřízne z compose TÝŽ úsek
# a TÝŽ healthcheck (init podle compose) a pustí je v jednorázovém kontejneru.
#
# ⛔ NAMĚŘENO JÍM 2026-09-25 (oba předpoklady byly opačné):
#   · lumberjack nový soubor otevírá BEZ O_APPEND → po zkrácení díra z nul;
#   · busybox `timeout` nechá po každém průchodu zombie pod PID 1 → `init: true`.
#
# Kdy pouštět: při změně úklidu, healthchecku edge nebo pinu Caddy. Po přechodu
# na Caddy ≥ 2.11.1 (roll_interval/roll_at) se úklid i tenhle skript ruší.
# Potřebuje Docker a obraz caddy:2.8.4-alpine; nic nesahá na instanci.
#   npm run e2e:edge-uklid
# =============================================================================
set -u
WT=$(cd "$(dirname "$0")/.." && pwd)
E=$(mktemp -d -t edge-uklid-e2e.XXXXXX)
trap 'docker rm -f e2e-edge-uklid >/dev/null 2>&1; docker volume rm e2e-edge-pristupy >/dev/null 2>&1; rm -rf "$E"' EXIT
cat > "$E/vstup.sh" <<'VSTUP'
#!/bin/sh
# Vstup E2E: týž úsek příkazu edge (vyříznutý z compose), Caddyfile jen s logem a health.
_door=observe
access_log=""
. /e2e/usek.sh
cat > /etc/caddy/Caddyfile <<EOF
{
  admin off
}
:8081 {
  respond /__edge_health 200
}
:80 {
  $access_log
  respond "ok" 200
}
EOF
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
VSTUP
IMG=caddy:2.8.4-alpine; C=e2e-edge-uklid; V=e2e-edge-pristupy; PORT=18480
ok=0; fail=0
zkontroluj() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1   [$2]"; fail=$((fail+1)); fi; }
x() { docker exec $C sh -c "$1"; }
pred() { date -u -r $(( $(date +%s) - $1 )) '+%Y-%m-%d %H:%M:%S'; }   # čas před N s (UTC, formát busybox touch -d)
req() { curl -s -o /dev/null "http://127.0.0.1:$PORT/?[1-$1]"; }
radku() { x "wc -l < /var/log/edge/$1 2>/dev/null || echo -1" | tr -d ' '; }
velikost() { x "stat -c %s /var/log/edge/$1 2>/dev/null || echo -1"; }
nuly() { x "tr -cd '\\000' < /var/log/edge/pristupy.log | wc -c" | tr -d ' '; }
nuly_v() { x "tr -cd '\\000' < /var/log/edge/$1 | wc -c" | tr -d ' '; }
radku_bez_nul() { x "tr -d '\\000' < /var/log/edge/$1 | grep -c '^{'" | tr -d ' '; }
cekej_uklid() { sleep "${1:-5}"; }   # interval healthchecku 2 s → 2+ průchody
DNES=$(date -u +%F)
uklid_konec() { docker rm -f $C >/dev/null 2>&1; docker volume rm $V >/dev/null 2>&1; }
uklid_konec

cd $WT
node -e '
const fs=require("fs"); const {parse}=require("yaml");
const c=fs.readFileSync("docker-compose.coolify-prebuilt.yml","utf8"); const r=c.split("\n");
const od=r.findIndex(x=>x.includes("── ÚKLID EVIDENCE ADRES"));
const po=r.findIndex((x,i)=>i>od && /^\s*if \[ "\$\$_door" = "enforce" \]; then$/.test(x));
if(od<0||po<0) throw new Error("úsek nenalezen");
fs.writeFileSync(process.argv[1]+"/usek.sh", r.slice(od,po).map(x=>x.replace(/^ {8}/,"")).join("\n").replace(/\$\$/g,"$")+"\n");
fs.writeFileSync(process.argv[1]+"/health.txt", parse(c).services["edge-proxy"].healthcheck.test[1].replace(/\$\$/g,"$"));
fs.writeFileSync(process.argv[1]+"/init.txt", parse(c).services["edge-proxy"].init === true ? "--init" : "");
' $E || exit 9
echo "commit: $(/usr/bin/git rev-parse --short HEAD)$(/usr/bin/git diff --quiet HEAD -- docker-compose.coolify-prebuilt.yml || echo '+necommitnuto')  obraz: $(docker image inspect $IMG --format '{{index .RepoDigests 0}}')"
INIT=$(cat $E/init.txt)
echo "healthcheck: $(cat $E/health.txt)"
if [ -n "$INIT" ]; then echo "init z compose: $INIT"; else echo "init z compose: (ne)"; fi
zombie() { x 'ps -o stat | grep -c ^Z' | tr -d ' '; }

echo "S0 neplatná lhůta → edge nenastartuje"
for L in 0 030 30d; do
  out=$(docker run --rm -v $E:/e2e:ro -e EDGE_ACCESS_RETENTION_DAYS=$L --entrypoint sh $IMG /e2e/vstup.sh 2>&1); rc=$?
  zkontroluj "EDGE_ACCESS_RETENTION_DAYS=$L → rc=1 a hláška" "[ $rc -eq 1 ] && echo \"\$out\" | grep -q 'není kladný počet dní'"
done

echo "S1 start (N=2), healthcheck vykonává Docker"
docker volume create $V >/dev/null
docker run -d $INIT --name $C -p 127.0.0.1:$PORT:80 -v $V:/var/log/edge -v $E:/e2e:ro -e EDGE_ACCESS_RETENTION_DAYS=2 \
  --health-cmd "$(cat $E/health.txt)" --health-interval 2s --health-timeout 5s --health-retries 5 \
  --entrypoint sh $IMG /e2e/vstup.sh >/dev/null
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' $C)" = healthy ] && break; sleep 1; done
zkontroluj "kontejner healthy" "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $C)\" = healthy ]"
zkontroluj "úklid vygenerován s N=2" "x 'grep -qx N=2 /tmp/edge-uklid.sh'"
echo "  busybox: $(x 'busybox 2>&1 | head -1')"; echo "  PID 1: $(x 'ps -o pid,args | awk "\$1==1"')"
sleep 8
zkontroluj "po ~5 průchodech healthchecku žádné zombie" "[ \"\$(zombie)\" = 0 ]"

echo "S2 první průchod bez .rez řízne hned"
curl -s -o /dev/null -H 'User-Agent: tajny-agent' -H 'Cookie: sezeni=tajne' "http://127.0.0.1:$PORT/cesta?token=tajny"
req 4; cekej_uklid 5
zkontroluj "archiv pristupy.log.$DNES má 5 řádků" "[ \"\$(radku pristupy.log.$DNES)\" = 5 ]"
zkontroluj "aktivní soubor zkrácen na 0" "[ \"\$(velikost pristupy.log)\" = 0 ]"
zkontroluj ".rez existuje" "x 'test -f /var/log/edge/.rez'"
POLE=$(x "head -1 /var/log/edge/pristupy.log.$DNES" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s),k=[];for(const[a,v]of Object.entries(j)){if(v&&typeof v==="object")for(const b of Object.keys(v))k.push(a+"."+b);else k.push(a)}console.log(k.sort().join(","))})')
echo "  pole: $POLE"
zkontroluj "minimalizace: v evidenci jen deklarovaná pole (bez hlaviček, URI, portu, velikostí)" "[ \"$POLE\" = 'level,logger,msg,request.client_ip,request.host,request.method,request.remote_ip,status,ts' ]"

echo "S3 po zkrácení: stará data pryč, nové řádky celé (díra z nul je fakt, ne vada)"
req 3; sleep 1
zkontroluj "aktivní má 3 řádky" "[ \"\$(radku pristupy.log)\" = 3 ]"
zkontroluj "mimo nuly nese aktivní jen 3 nové řádky (stará data uvolněna)" "[ \"\$(radku_bez_nul pristupy.log)\" = 3 ]"
echo "  fakt: díra z nul před novými řádky $(nuly) B (lumberjack bez O_APPEND); na disku $(x 'du -k /var/log/edge/pristupy.log | cut -f1') KiB z $(velikost pristupy.log) B"
cekej_uklid 5
zkontroluj "do 24 h se neřeže znovu (aktivní pořád 3)" "[ \"\$(radku pristupy.log)\" = 3 ]"

echo "S4 .rez starší 24 h → řez"
x "touch -d '$(pred 90000)' /var/log/edge/.rez"; cekej_uklid 5
zkontroluj "aktivní zkrácen" "[ \"\$(velikost pristupy.log)\" = 0 ]"
zkontroluj "archiv dne má 3 řádky (týž den přepsán nadmnožinou)" "[ \"\$(radku pristupy.log.$DNES)\" = 3 ]"
zkontroluj "archiv nenese nuly z díry" "[ \"\$(nuly_v pristupy.log.$DNES)\" = 0 ]"

echo "S5 mazání po N dnech (i zálohy Caddy), dočasný řez po 10 min"
x "cd /var/log/edge && echo x > pristupy.log.2026-01-01 && touch -d '$(pred $((3*86400)))' pristupy.log.2026-01-01 \
 && echo x > pristupy-2026-01-01T00-00-00.000.log.gz && touch -d '$(pred $((3*86400)))' pristupy-2026-01-01T00-00-00.000.log.gz \
 && echo x > pristupy.log.2026-09-24 && touch -d '$(pred 86400)' pristupy.log.2026-09-24 \
 && echo x > .rez-rozpracovano && touch -d '$(pred 660)' .rez-rozpracovano \
 && echo x > jiny.log && touch -d '$(pred $((10*86400)))' jiny.log"
cekej_uklid 5
zkontroluj "archiv za lhůtou smazán" "! x 'test -e /var/log/edge/pristupy.log.2026-01-01'"
zkontroluj "záloha lumberjacku za lhůtou smazána" "! x 'test -e /var/log/edge/pristupy-2026-01-01T00-00-00.000.log.gz'"
zkontroluj "archiv v lhůtě zůstal" "x 'test -e /var/log/edge/pristupy.log.2026-09-24'"
zkontroluj "dočasný řez starší 10 min smazán" "! x 'test -e /var/log/edge/.rez-rozpracovano'"
zkontroluj "cizí soubor zůstal" "x 'test -e /var/log/edge/jiny.log'"
zkontroluj "aktivní soubor zůstal" "x 'test -e /var/log/edge/pristupy.log'"

echo "S6 zámek: čerstvý = nic; starší 10 min = převzít"
x "mkdir /tmp/edge-uklid.zamek"; req 2; x "touch -d '$(pred 90000)' /var/log/edge/.rez"; cekej_uklid 6
zkontroluj "s čerstvým zámkem se neřeže" "[ \"\$(radku pristupy.log)\" = 2 ]"
x "touch -d '$(pred 660)' /tmp/edge-uklid.zamek"; cekej_uklid 5
zkontroluj "zámek zabitého běhu převzat → řez proběhl" "[ \"\$(velikost pristupy.log)\" = 0 ]"
zkontroluj "zámek po průchodu neleží" "! x 'test -e /tmp/edge-uklid.zamek'"

echo "S7 .rez přežije restart, restart neřeže"
req 1; M1=$(x 'stat -c %Y /var/log/edge/.rez'); A1=$(x 'ls /var/log/edge | wc -l')
docker restart $C >/dev/null
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' $C)" = healthy ] && break; sleep 1; done
cekej_uklid 4
zkontroluj ".rez má po restartu týž čas" "[ \"\$(x 'stat -c %Y /var/log/edge/.rez')\" = \"$M1\" ]"
zkontroluj "po restartu se neřezalo (aktivní drží 1 řádek)" "[ \"\$(radku pristupy.log)\" = 1 ]"

echo "S8 rotace lumberjacku po zkrácení (počitadlo nesedí → rotace dřív)"
H=$(printf 'a%.0s' $(seq 1 7000)).example
curl -s -o /dev/null -H "Host: $H" "http://127.0.0.1:$PORT/?[1-900]"
echo "  před řezem: $(velikost pristupy.log) B"
x "touch -d '$(pred 90000)' /var/log/edge/.rez"; cekej_uklid 5
zkontroluj "řez zkrátil velký aktivní soubor" "[ \"\$(velikost pristupy.log)\" -lt 100000 ]"
curl -s -o /dev/null -H "Host: $H" "http://127.0.0.1:$PORT/?[1-700]"; sleep 3
S=$(velikost pristupy.log); Z=$(x 'ls /var/log/edge | grep -cE "^pristupy-.*\.log(\.gz)?$"' | tr -d ' ')
echo "  po dalších ~5 MiB: aktivní $S B, záloh lumberjacku $Z"
zkontroluj "lumberjack po zkrácení rotuje (dřív než při 10 MiB souboru)" "[ \"$Z\" -ge 1 ] && [ \"$S\" -lt 10485760 ]"
req 2; sleep 1
zkontroluj "po rotaci se dál zapisuje" "[ \"\$(radku pristupy.log)\" -ge 1 ]"

echo "S9a skutečný úklid zavěšený (zápis do FIFO blokuje) → zámek brání hromadění, zdraví drží"
req 2; x "cd /var/log/edge && rm -f .rez-rozpracovano && mkfifo .rez-rozpracovano"
x "touch -d '$(pred 90000)' /var/log/edge/.rez"; sleep 9
zkontroluj "healthy, poslední kódy 0" "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $C)\" = healthy ] && [ -z \"\$(docker inspect -f '{{range .State.Health.Log}}{{.ExitCode}} {{end}}' $C | tr -d '0 ')\" ]"
VIS=$(x 'ps -o args | grep -c "/tmp/edge-uklid.s[h]"' | tr -d ' ')
zkontroluj "visí nejvýš jeden úklid (zámek)" "[ \"$VIS\" -le 1 ]"
zkontroluj "zámek zabitého průchodu leží (převezme se po 10 min)" "x 'test -d /tmp/edge-uklid.zamek'"
zkontroluj "aktivní soubor nezkrácen (řez nedoběhl, data čekají)" "[ \"\$(radku_bez_nul pristupy.log)\" -ge 2 ]"
zkontroluj "žádné zombie" "[ \"\$(zombie)\" = 0 ]"
x "rm -f /var/log/edge/.rez-rozpracovano; rm -rf /tmp/edge-uklid.zamek"
echo "S9b úklid selže / visí (atrapy) → zdraví to neovlivní (busybox timeout)"
x "printf '#!/bin/sh\nexit 1\n' > /tmp/edge-uklid.sh"; sleep 7
zkontroluj "selhávající úklid: healthy, poslední kódy 0" "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $C)\" = healthy ] && [ -z \"\$(docker inspect -f '{{range .State.Health.Log}}{{.ExitCode}} {{end}}' $C | tr -d '0 ')\" ]"
x "printf '#!/bin/sh\nsleep 30\n' > /tmp/edge-uklid.sh"; sleep 9
zkontroluj "visící úklid: healthy (timeout 2 ho utne pod 5 s)" "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $C)\" = healthy ] && [ -z \"\$(docker inspect -f '{{range .State.Health.Log}}{{.ExitCode}} {{end}}' $C | tr -d '0 ')\" ]"

echo "S10 nástroj dvorníka čte kopii adresáře (archivy + gzip zálohy)"
rm -rf $E/kopie; docker cp $C:/var/log/edge $E/kopie >/dev/null 2>&1
J=$(node $WT/scripts/dvernik-evidence.mjs --log $E/kopie/pristupy.log --env-soubor /neni --json 2>/dev/null)
echo "  $(echo "$J" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`řádků ${j.radku}, nečitelných řádků ${j.preskoceno}, nečitelných souborů ${j.nectene.length}, lhůta ${j.lhuta.dni} (${j.lhuta.zdroj}), porušena ${j.lhuta.porusena}`)})')"
zkontroluj "gzip zálohy i řádky za dírou přečteny (nečitelný jen podvržený řádek x)" "echo \"\$J\" | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s);process.exit(j.preskoceno===1&&j.nectene.length===0?0:1)})'"
rm -rf $E/kopie

zkontroluj "na konci žádné zombie" "[ \"\$(zombie)\" = 0 ]"
uklid_konec
echo "VÝSLEDEK: $ok ✓, $fail ✗"
[ $fail -eq 0 ]
