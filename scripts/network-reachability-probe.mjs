#!/usr/bin/env node
/**
 * network-reachability-probe.mjs — ŽIVÝ dosah mezi službami, změřený, ne odvozený.
 *
 * PROČ (2026-07-29)
 * ----------------
 * network-policy-report.mjs čte repo a říká, co by MĚLO platit. Tenhle skript se
 * ptá běžící instalace, co platí SKUTEČNĚ — otevře TCP z kontejneru jedné služby
 * na endpointy ostatních a vypíše, co prošlo.
 *
 * Rozdíl mezi tím dvojím je celý smysl: statická analýza řekne „těchhle 57 volání
 * se používá", živá sonda řekne „a tohle všechno navíc jde otevřít". Bez druhého
 * čísla je segmentace odhad.
 *
 * Je to zároveň měření PŘED/PO: až se sítě rozdělí, tenhle skript musí ukázat,
 * že nadbytečný dosah zmizel — a že žádné skutečné volání nezmizelo s ním.
 *
 * ČTE, NEMĚNÍ. Jen `docker exec` + TCP connect s krátkým timeoutem.
 *
 * Použití:
 *   node scripts/network-reachability-probe.mjs                    # lokální docker
 *   SSH_HOST=uzivatel@stroj node scripts/network-reachability-probe.mjs
 *   SSH_HOST=… node scripts/network-reachability-probe.mjs --json
 *   SSH_HOST=… node scripts/network-reachability-probe.mjs --from=ai-chat,openclaw
 *
 * POZNÁMKA K MĚŘIDLU
 * ------------------
 * Sonda běží UVNITŘ kontejneru, takže potřebuje tamní runtime. Zkouší node, pak
 * python3, pak /dev/tcp v shellu — a když neuspěje ani jedno, hlásí to jako
 * NEZMĚŘENO, ne jako „nedosáhne". Prázdný výsledek z chybějícího nástroje vypadá
 * úplně stejně jako uzavřená síť; tenhle rozdíl stál dnes hodinu.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { containerNameFrom } from "./lib/derive-domains.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_NAME_PREFIX = (process.env.APP_NAME_PREFIX || "").trim();
const SSH_HOST = process.env.SSH_HOST || "";
const JSON_OUT = process.argv.includes("--json");
const ONLY = (process.argv.find((a) => a.startsWith("--from=")) || "").split("=")[1];
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 3000);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function sh(cmd) {
  const args = SSH_HOST ? ["-o", "ConnectTimeout=8", SSH_HOST, cmd] : ["-c", cmd];
  const bin = SSH_HOST ? "ssh" : "sh";
  try {
    return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch (e) {
    return (e.stdout || "").trim();
  }
}

/**
 * Cíle: alias + port ZE STEJNÉHO bloku služby.
 *
 * První pokus bral první `container_name` v souboru a první `expose` port —
 * jenže první container_name je typicky `pki-init` (init kontejner, který
 * skončí) a port patřil jiné službě. Vznikaly cíle jako `aisha-pki-init:5432`,
 * tedy měření něčeho, co nikdy neexistovalo.
 *
 * A `container_name` NENÍ běžící jméno: Coolify kontejnery přejmenovává na
 * `<služba>-<uuid>-<n>`, takže `aisha-gateway` na hostu nenajdeš. Co přežívá,
 * je NETWORK ALIAS — proto se cíle staví z aliasů, ne ze jmen.
 */
/**
 * Interpolace `${VAR}` / `${VAR:-def}` / `${VAR:?msg}` proti .env.coolify.
 *
 * ⛔ NAMĚŘENO 2026-08-13: aliasy v compose se přejmenovaly na
 * `${APP_NAME_PREFIX:?identita instance}-db` a parser s třídou znaků
 * `[a-z0-9._${}-]` (bez mezer a `?`) je přestal číst ÚPLNĚ — sonda pak měla
 * 0 cílů a hlásila „žádný běžící kontejner neodpovídá katalogu", což vypadá
 * jako nenasazený stack, ne jako slepý parser. Parser přišpendlený na tvar,
 * ze kterého repo odrostlo, je táž rodina jako brána čtoucí prózu jako kód.
 */
function envColify() {
  const out = {};
  const f = resolve(ROOT, ".env.coolify");
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const ENV = envColify();

function interpolate(value) {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::[-?][^}]*)?\}/g, (_, name) =>
    process.env[name] ?? ENV[name] ?? "",
  );
}

function parseServiceBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  let inServices = false, cur = null;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-zA-Z]/.test(line)) break;
    const head = inServices && line.match(/^  ([a-z0-9][a-z0-9._-]*):\s*$/);
    if (head) { cur = { name: head[1], aliases: new Set(), ports: [] }; blocks.push(cur); continue; }
    if (!cur) continue;
    // Alias smí nést `${VAR:?zpráva s mezerami}` — proto se bere celý zbytek
    // řádku a interpoluje se, místo aby se tvar hádal třídou znaků.
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!item) continue;
    const raw = item[1].replace(/^["']|["']$/g, "");
    const port = raw.match(/^(\d{2,5})$/);
    if (port) { cur.ports.push(Number(port[1])); continue; }
    const val = interpolate(raw);
    // Platný alias po interpolaci: DNS-ové jméno s aspoň jedním písmenem.
    if (val && /^[a-z0-9][a-z0-9._-]*$/.test(val) && /[a-z]/.test(val)) cur.aliases.add(val);
  }
  return blocks;
}

function targetsFromCatalog() {
  const catalog = JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8")).services;
  const targets = [];
  for (const [id, svc] of Object.entries(catalog)) {
    // Jméno kontejneru se SKLÁDÁ z identity — katalog na compose službu jen
    // ukazuje (`internal_url.service`). Sonda bez identity by měřila jméno,
    // které na téhle instanci nikomu nepatří.
    if (svc.internal_url?.service && svc.internal_url?.port) {
      const host = containerNameFrom(svc.compose, svc.internal_url.service, APP_NAME_PREFIX);
      if (host) {
        targets.push({ service: id, host, port: svc.internal_url.port, composeService: svc.internal_url.service });
        continue;
      }
    }
    const f = svc.compose ? resolve(ROOT, svc.compose) : null;
    if (!f || !existsSync(f)) continue;
    // blok, který má ALIAS i PORT — init kontejnery ani jedno nemají, takže vypadnou
    for (const b of parseServiceBlocks(readFileSync(f, "utf8"))) {
      if (!b.aliases.size || !b.ports.length) continue;
      targets.push({ service: id, host: [...b.aliases][0], port: b.ports[0], composeService: b.name });
      break;
    }
  }
  return targets;
}

/** Jeden běžící kontejner na službu — odkud se bude sondovat. */
function originContainers(targets) {
  const running = sh(`docker ps --format '{{.Names}}'`).split("\n").filter(Boolean);
  const origins = [];
  const prefix = (process.env.APP_NAME_PREFIX ?? ENV.APP_NAME_PREFIX ?? "").replace(/[-.]$/, "");
  for (const t of targets) {
    // Coolify přejmenovává na `<compose-služba>-<uuid>-<n>` — běžící jméno tedy
    // začíná jménem SLUŽBY z compose, ne aliasem. Alias zůstává jako druhá
    // šance (internal_url cíle compose jméno nemají).
    const kandidati = [t.composeService, t.host, t.host.replace(new RegExp(`^${prefix}-+`), "")]
      .filter(Boolean);
    const hit = running.find((n) => kandidati.some((k) => n === k || n.startsWith(`${k}-`)));
    if (hit) origins.push({ service: t.service, container: hit });
  }
  return origins;
}

/**
 * Sonda uvnitř kontejneru. Vrací mapu "host:port" → true/false, nebo null když
 * v kontejneru není čím měřit — což NENÍ totéž jako „nedosáhne".
 */
function probeFrom(container, targets) {
  const list = targets.map((t) => `${t.host}:${t.port}`).join(" ");

  /** Rozparsuj výstup sondy. Prázdná mapa = tenhle způsob neuspěl. */
  const parse = (raw) => {
    const map = new Map();
    for (const kv of String(raw || "").split(/\s+/)) {
      const m = kv.match(/^(.+):(\d+)=([01])$/);
      if (m) map.set(`${m[1]}:${m[2]}`, m[3] === "1");
    }
    return map;
  };

  const nodeScript =
    `const net=require('net');const ts=process.argv.slice(1);let i=0;const out=[];` +
    `(function nx(){if(i>=ts.length){console.log(out.join(' '));return;}` +
    `const [h,p]=ts[i++].split(':');const s=net.connect({host:h,port:+p,timeout:${TIMEOUT_MS}});` +
    `const done=(ok)=>{out.push(h+':'+p+'='+(ok?1:0));s.destroy();nx();};` +
    `s.on('connect',()=>done(true));s.on('error',()=>done(false));s.on('timeout',()=>done(false));})();`;

  // `command -v nc` je POJISTKA, ne kosmetika: bez ní shell spadne do větve
  // `else` a vypíše `=0` pro každý cíl, takže chybějící nástroj vypadá jako
  // UZAVŘENÁ SÍŤ. To je nejnebezpečnější možný výsledek — segmentace by se
  // jevila jako hotová. Změřeno 2026-07-29: core/netbird/model/potok takhle
  // vyšly na „dosáhne na 0", přestože jsou na ploché síti jako všichni ostatní.
  const shBody =
    `command -v nc >/dev/null 2>&1 || exit 0; ` +
    `for t in "$@"; do h=\${t%:*}; p=\${t##*:}; ` +
    `if nc -z -w ${Math.ceil(TIMEOUT_MS / 1000)} "$h" "$p" 2>/dev/null; ` +
    `then printf "%s=1 " "$t"; else printf "%s=0 " "$t"; fi; done`;
  const b64 = Buffer.from(shBody).toString("base64");

  // Tři způsoby, každý se ZKUSÍ A ROZPARSUJE. Dřív se jen testovalo, jestli
  // výstup není prázdný — jenže `node -e` v kontejneru bez node vypíše chybu na
  // stdout, což je neprázdné, takže se další způsob nikdy nespustil a služba
  // vyšla jako NEZMĚŘENO, přestože nc v ní byl a ručně fungoval.
  const attempts = [
    `docker exec ${container} node -e "${nodeScript.replace(/"/g, '\\"')}" ${list} 2>/dev/null`,
    `docker exec ${container} sh -c 'echo ${b64} | base64 -d > /tmp/.probe.sh; sh /tmp/.probe.sh _ ${list}; rm -f /tmp/.probe.sh' 2>/dev/null`,
  ];

  for (const cmd of attempts) {
    const map = parse(sh(cmd));
    map.delete("_:0");
    if (map.size) return map;
  }
  return null; // NEZMĚŘENO — není čím měřit. NENÍ totéž jako „nedosáhne".
}

function main() {
  const targets = targetsFromCatalog();
  let origins = originContainers(targets);
  if (ONLY) {
    const want = new Set(ONLY.split(","));
    origins = origins.filter((o) => want.has(o.service));
  }

  if (!origins.length) {
    process.stderr.write("Žádný běžící kontejner neodpovídá katalogu — nasazeno? SSH_HOST správně?\n");
    process.exit(2);
  }

  const results = [];
  for (const o of origins) {
    const map = probeFrom(o.container, targets.filter((t) => t.service !== o.service));
    if (!map) {
      results.push({ from: o.service, container: o.container, measured: false, reached: [] });
      continue;
    }
    const reached = targets
      .filter((t) => t.service !== o.service && map.get(`${t.host}:${t.port}`))
      .map((t) => t.service);
    results.push({ from: o.service, container: o.container, measured: true, reached });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ targets, results }, null, 2));
    return;
  }

  console.log(C.bold("\nŽivý dosah mezi službami\n"));
  console.log(C.dim(`  cílů z katalogu: ${targets.length} · sondováno z: ${origins.length} kontejnerů\n`));

  const w = Math.max(...results.map((r) => r.from.length));
  let totalReach = 0;
  let unmeasured = 0;
  for (const r of results.sort((a, b) => b.reached.length - a.reached.length)) {
    if (!r.measured) {
      unmeasured += 1;
      console.log(`  ${r.from.padEnd(w)}  ${C.yellow("NEZMĚŘENO")} ${C.dim("(není čím měřit: node, python3 ani nc)")}`);
      continue;
    }
    totalReach += r.reached.length;
    const n = r.reached.length;
    const tag = n === 0 ? C.green("0") : n > 10 ? C.red(String(n)) : C.yellow(String(n));
    console.log(`  ${r.from.padEnd(w)}  dosáhne na ${tag} služeb  ${C.dim(r.reached.slice(0, 6).join(", "))}`);
  }

  console.log(
    `\n  ${C.bold("Celkem")}: ${C.red(String(totalReach))} otevřených cest` +
    (unmeasured ? C.yellow(`, ${unmeasured} služeb NEZMĚŘENO`) : "") +
    `\n  ${C.dim("Porovnej s `node scripts/network-policy-report.mjs` — rozdíl je to, co segmentace zavře.")}\n`,
  );
}

main();
