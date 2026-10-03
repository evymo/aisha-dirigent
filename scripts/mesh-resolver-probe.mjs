#!/usr/bin/env node
// mesh-resolver-probe.mjs — ptá se MESHE, ne deklarací.
//
//   node scripts/mesh-resolver-probe.mjs --host <jméno>=<adresa> --host <jméno>=<adresa> \
//        --jmeno <prefix>-postgrest.mesh.<tld> --port 3000
//
// ⛔ PROČ VZNIKL (naměřeno 2026-09-06). `live.` vracelo 502 a příčinou byl mesh
// resolver, který na dvou ze tří strojů NEEXISTOVAL — adresu `.250` tam nedržel
// nikdo. Přesto všechno hlásilo zdraví: ze 190 healthchecků v repu se ani jeden
// neptal ven z vlastního kontejneru a ani jeden nepoložil DNS dotaz. Mrtvý
// resolver tak čekal na otázku, kterou nikdo nepokládal, a 48 kontejnerů
// mířilo `dns:` do prázdna.
//
// ⭐ MĚŘÍ SE OBĚ PŮLKY, PROTOŽE SAMOTNÁ PRVNÍ LŽE:
//     1. PŘEKLAD  — odpovídá resolver na tomto stroji?
//     2. SPOJENÍ  — je přeložená adresa dosažitelná (routa do rozsahu peerů)?
// Kontejner s resolverem a bez routy jméno PŘELOŽÍ a nespojí se; navenek to
// vypadá jako pomalá služba, ne jako chybějící routa. Změřeno na `web`:
//     getent hosts <prefix>-postgrest.mesh.<mesh_tld> → <mesh IP peeru>
//     nc -z <mesh IP peeru> 3000       → NEDOSAZITELNE
//
// ⛔ NEZMĚŘENO NENÍ ZELENÁ. Když se na stroj nedostaneme, řekne se to nahlas a
// skončí se nenulově. Tichý přeskok by vyrobil přesně tu falešnou zelenou,
// kvůli které se tahle třída vad hledá pět vrstev od příznaku.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const hosty = [];
let jmeno = "";
let port = "";
let sshUser = process.env.MESH_PROBE_SSH_USER || "";
// ⛔ NAMĚŘENO 2026-09-07: bez identity instance si sonda na SDÍLENÉM stroji vybrala
// kontejner CIZÍHO nájemníka (na Varře `svc-blockchain-…`, na Talosu cizí edge-proxy)
// a hlásila „resolver mlčí", zatímco NÁŠ resolver tamtéž překládal správně. Měřidlo,
// které měří cizí věc, je horší než žádné — proto se síť hledá jménem s prefixem.
let instance = process.env.APP_NAME_PREFIX || "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--host") { const [n, a] = String(args[++i]).split("="); hosty.push({ jmeno: n, adresa: a || n }); }
  else if (args[i] === "--jmeno") jmeno = args[++i];
  else if (args[i] === "--port") port = args[++i];
  else if (args[i] === "--ssh-user") sshUser = args[++i];
  else if (args[i] === "--instance") instance = args[++i];
}
if (hosty.length === 0 || !jmeno || !instance) {
  console.error("použití: --host <jméno>=<adresa> [--host …] --jmeno <mesh FQDN> --instance <prefix> [--port <p>] [--ssh-user <u>]");
  console.error("(--instance lze vzít i z APP_NAME_PREFIX; bez něj by sonda měřila cizí nájemníky)");
  console.error("(hostitelé se NEODVOZUJÍ ze souboru — identita instance do forku nepatří)");
  process.exit(2);
}

const cil = (h) => (sshUser ? `${sshUser}@${h.adresa}` : h.adresa);

function naStroji(h, skript) {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", cil(h), skript], {
    encoding: "utf-8", timeout: 60_000,
  });
}

// Jeden shell na stroj: najdi kontejner, který má `dns:` na mesh resolver, a
// zeptej se z NĚJ. Ptát se z hostitele by měřilo něco jiného — hostitel mesh
// resolver v resolv.conf nemá a jeho routy nejsou routy kontejneru.
const SKRIPT = (jm, pt, inst) => `
set -u
# ⛔ SUBJEKT MUSÍ SPLŇOVAT OBOJÍ (naměřeno 2026-09-06). První verze brala první
# kontejner s dns: na resolver — a vybrala web z jádra, který na síti mesh-dns
# NENÍ. Ten na .250 nedosáhne (100 % ztráta paketů) bez ohledu na to, jestli
# resolver běží, takže sonda hlásila resolver mlci i minutu po jeho úspěšném
# nasazení. Měřit se musí na kontejneru, který resolver má ČÍM oslovit.
#
# Kontejnery s dns: a BEZ členství na té síti jsou samostatný nález, ne šum:
# míří na adresu, kterou nemají jak dosáhnout.
K=""; MIMO=""
for c in $(docker ps --format '{{.Names}}'); do
  d=$(docker inspect --format '{{json .HostConfig.Dns}}' "$c" 2>/dev/null || echo null)
  case "$d" in null|'[]') continue;; esac
  case "$d" in *10.*|*172.*|*192.*) ;; *) continue;; esac
  n=$(docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c" 2>/dev/null)
  case "$n" in *${inst}-mesh-dns*) ;; *) MIMO="$MIMO $c"; continue;; esac
  case "$c" in mesh-router-*) continue;; esac   # resolver sám sebe neměří
  K="$c"; break
done
for m in $MIMO; do echo "MIMO_SIT=$m"; done
[ -z "$K" ] && { echo "BEZ_KONZUMENTA"; exit 0; }
echo "KONTEJNER=$K"
A=$(docker exec "$K" getent hosts '${jm}' 2>/dev/null | awk '{print $1}' | head -1)
[ -z "$A" ] && { echo "NEPRELOZI"; exit 0; }
echo "ADRESA=$A"
${pt ? `docker exec "$K" sh -c "timeout 5 nc -z -w 3 $A ${pt}" >/dev/null 2>&1 && echo SPOJI || echo NESPOJI` : "echo BEZ_PORTU"}
`;

let selhani = 0;
console.log(`mesh probe — jméno: ${jmeno}${port ? `:${port}` : ""}\n`);
for (const h of hosty) {
  let vystup;
  try {
    vystup = naStroji(h, SKRIPT(jmeno, port, instance));
  } catch (e) {
    console.log(`  ${h.jmeno.padEnd(12)} NEZMĚŘENO — stroj nedosažitelný (${String(e.message).split("\n")[0]})`);
    selhani++;
    continue;
  }
  const radky = vystup.split("\n").map((r) => r.trim()).filter(Boolean);
  const kontejner = (radky.find((r) => r.startsWith("KONTEJNER=")) || "").split("=")[1] || "?";
  const adresa = (radky.find((r) => r.startsWith("ADRESA=")) || "").split("=")[1] || "";
  const mimoSit = radky.filter((r) => r.startsWith("MIMO_SIT=")).map((r) => r.split("=")[1]);
  if (mimoSit.length) {
    console.log(`  ${h.jmeno.padEnd(12)} ⚠ ${mimoSit.length} kontejner(ů) má dns: na resolver, ale NENÍ na jeho síti:`);
    for (const m of mimoSit.slice(0, 5)) console.log(`  ${"".padEnd(12)}    ${m.replace(/-[0-9]{6,}$/, "")}`);
    if (mimoSit.length > 5) console.log(`  ${"".padEnd(12)}    … a dalších ${mimoSit.length - 5}`);
  }
  if (radky.includes("BEZ_KONZUMENTA")) { console.log(`  ${h.jmeno.padEnd(12)} přeskočeno — na stroji není konzument mesh DNS na síti resolveru`); continue; }
  if (radky.includes("NEPRELOZI")) {
    console.log(`  ${h.jmeno.padEnd(12)} ⛔ RESOLVER MLČÍ — ${kontejner} jméno nepřeložil`);
    console.log(`  ${"".padEnd(12)}    na tomhle stroji nedrží pin nikdo → doplň mesh-router-<slot> do katalogu`);
    selhani++; continue;
  }
  if (radky.includes("NESPOJI")) {
    console.log(`  ${h.jmeno.padEnd(12)} ⛔ PŘELOŽÍ, NESPOJÍ SE — ${adresa} je nedosažitelná`);
    console.log(`  ${"".padEnd(12)}    resolver je, routa do rozsahu peerů chybí (cap_add NET_ADMIN + mesh-client-route.sh)`);
    selhani++; continue;
  }
  if (radky.includes("SPOJI")) { console.log(`  ${h.jmeno.padEnd(12)} ✓ přeloží (${adresa}) i spojí`); continue; }
  console.log(`  ${h.jmeno.padEnd(12)} ✓ přeloží (${adresa}); spojení neměřeno (bez --port)`);
}
console.log("");
if (selhani > 0) { console.error(`${selhani} stroj(ů) mimo — mesh NENÍ celá zapnutá`); process.exit(1); }
console.log("všechny měřené stroje: mesh odpovídá i doručuje");
