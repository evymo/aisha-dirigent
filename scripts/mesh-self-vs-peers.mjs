#!/usr/bin/env node
/**
 * mesh-self-vs-peers.mjs — JAK SE VIDÍME × JAK NÁS VIDÍ OSTATNÍ.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-24)
 * -------------------------------------
 * O meshi máme 18 bran. Po síti nesahá ANI JEDNA — pět z nich spouští proces,
 * ale ty procesy čtou repo. Test na rozpor mezi tím, co si o sobě myslí peer,
 * a tím, co o něm ví management, tedy neexistoval vůbec. A právě ten rozpor je
 * typický tvar poruchy meshe:
 *
 *   - agent běží, ale `wt0` nemá  → není v meshi, přestože kontejner je „healthy"
 *   - management peera zná        → ale kontejner s tou IP tu není (zapomenutý záznam)
 *   - obojí existuje              → ale management hlásí `connected=false`
 *
 * ⛔ MĚŘIDLO SE NESMÍ PTÁT `netbird status`. V našich sidecarech běží netbird
 * bez démona, takže `/var/run/netbird.sock` NEEXISTUJE a CLI odpoví
 * „failed to connect to daemon" — tedy MRTVÝ MESH NA ŽIVÉM MESHI. Pravda je
 * v `ip addr show wt0` uvnitř netns. (Viz poznámka „netbird.sock není měřidlo".)
 *
 * ⛔ UNIVERZUM SE HLEDÁ, NEPÍŠE. První verze téhle sondy brala „kontejnery
 * jménem netbird-agent" — a minula `edge`, který je v meshi přes kontejner
 * `mesh-router`. Hledá se proto podle VLASTNOSTI (má wt0), ne podle jména.
 *
 * Použití:
 *   node scripts/mesh-self-vs-peers.mjs                  # lokální docker
 *   SSH_HOST=uzivatel@stroj node scripts/mesh-self-vs-peers.mjs
 *   SSH_HOST=… node scripts/mesh-self-vs-peers.mjs --json
 *
 * Návratové kódy:
 *   0 — pohledy se shodují
 *   1 — ROZPOR (peer bez wt0, neznámý peer, odpojený peer)
 *   2 — NEZMĚŘENO (docker/management nedostupný) — což NENÍ totéž co „čisto"
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SSH_HOST = process.env.SSH_HOST || "";
const JSON_OUT = process.argv.includes("--json");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = JSON_OUT ? () => {} : (...a) => console.log(...a);

function sh(cmd) {
  const bin = SSH_HOST ? "ssh" : "sh";
  const args = SSH_HOST ? ["-o", "ConnectTimeout=10", SSH_HOST, cmd] : ["-c", cmd];
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

/** POHLED NA SEBE — univerzum se HLEDÁ podle vlastnosti „má wt0". */
function pohledNaSebe() {
  const out = sh(
    'for c in $(docker ps --format "{{.Names}}"); do ' +
      'ip=$(docker exec "$c" ip -o -4 addr show wt0 2>/dev/null | awk "{print \\$4}" | cut -d/ -f1); ' +
      'if [ -n "$ip" ]; then echo "$ip $c"; fi; done',
  );
  const podleIp = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [ip, ...rest] = line.trim().split(/\s+/);
    // ⛔ `docker exec` u kontejneru bez `ip(8)` vypíše chybovou hlášku, ze které
    // awk vytáhne slovo („failed") a to by se JINAK stalo „adresou" a vyrobilo
    // falešný nález. Sonda musí umět odpovědět „ne" — co není IPv4, není adresa.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
    if (!podleIp.has(ip)) podleIp.set(ip, []);
    podleIp.get(ip).push(rest.join(" "));
  }
  return podleIp;
}

/** Kontejnery, které vypadají jako mesh účastník, ale wt0 NEMAJÍ. */
function bezWt0() {
  const out = sh(
    'for c in $(docker ps --format "{{.Names}}"); do ' +
      'case "$c" in *netbird-agent*|*mesh-ingress*|*mesh-tcp*|*mesh-router*) ' +
      'if ! docker exec "$c" ip -o -4 addr show wt0 >/dev/null 2>&1; then echo "$c"; fi;; esac; done',
  );
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** POHLED OSTATNÍCH — management API, přes už existující nástroj. */
function pohledOstatnich() {
  const raw = execFileSync("node", [`${ROOT}/scripts/netbird-peer-discover.mjs`, "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

let self_, chybejici, peers;
try {
  self_ = pohledNaSebe();
  chybejici = bezWt0();
} catch (e) {
  log(C.red(`NEZMĚŘENO: docker nedostupný — ${e.message.split("\n")[0]}`));
  process.exit(2);
}
try {
  peers = pohledOstatnich();
} catch (e) {
  log(C.red(`NEZMĚŘENO: management API neodpovědělo — ${e.message.split("\n")[0]}`));
  log(C.dim("  Prázdný seznam peerů vypadá stejně jako prázdný mesh. Proto exit 2, ne 0."));
  process.exit(2);
}

const peerPodleIp = new Map(peers.filter((p) => p.ip).map((p) => [p.ip, p]));
const nalezy = { vidimSeNeznaMe: [], znaMeNejsemTu: [], odpojen: [], bezWt0: chybejici };

for (const [ip, kontejnery] of self_) {
  const p = peerPodleIp.get(ip);
  if (!p) nalezy.vidimSeNeznaMe.push({ ip, kontejnery });
  else if (!p.connected) nalezy.odpojen.push({ ip, hostname: p.hostname, kontejnery });
}
for (const [ip, p] of peerPodleIp) {
  if (!self_.has(ip)) nalezy.znaMeNejsemTu.push({ ip, hostname: p.hostname, connected: p.connected, lastSeen: p.lastSeen });
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ selfCount: self_.size, peerCount: peerPodleIp.size, nalezy }, null, 2) + "\n");
} else {
  log(C.bold("\n🕸  Mesh: jak se vidíme × jak nás vidí ostatní\n"));
  log(`  ${C.dim("kontejnerů s wt0:")}     ${self_.size} adres`);
  log(`  ${C.dim("peerů v managementu:")}  ${peerPodleIp.size}\n`);

  const sekce = (nadpis, polozky, render, barva = C.red) => {
    if (!polozky.length) { log(`  ${C.green("✓")} ${nadpis}: žádný`); return; }
    log(`\n  ${barva(nadpis)} (${polozky.length}):`);
    for (const p of polozky) log(`    ${render(p)}`);
  };
  sekce("VIDÍM SE, ale management mě NEZNÁ", nalezy.vidimSeNeznaMe,
    (p) => `${p.ip.padEnd(18)} ${p.kontejnery.join(", ")}`);
  sekce("MANAGEMENT MĚ ZNÁ, ale tu IP tu nikdo nemá", nalezy.znaMeNejsemTu,
    (p) => `${p.ip.padEnd(18)} ${String(p.hostname).padEnd(28)} connected=${p.connected} lastSeen=${String(p.lastSeen).slice(0, 19)}`,
    C.yellow);
  sekce("management hlásí ODPOJEN", nalezy.odpojen,
    (p) => `${p.ip.padEnd(18)} ${p.hostname}`);
  sekce("mesh kontejner BEZ wt0 (není v meshi)", nalezy.bezWt0, (c) => c);
  log("");
}

const rozpor = nalezy.vidimSeNeznaMe.length + nalezy.odpojen.length + nalezy.bezWt0.length;
process.exit(rozpor > 0 ? 1 : 0);
