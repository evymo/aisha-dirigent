#!/usr/bin/env node
/**
 * routing-probe-cli.mjs — dveře do jediného domova verdiktu pro shellové nástroje.
 *
 * PROČ EXISTUJE: verdikt „žije to" měl čtyři domovy a ani jeden neuměl rozeznat
 * odpověď, která není od služby — to uměl jedině `coolify-domain-doctor.mjs`,
 * jediný konzument sdílené sondy. Zbylé porovnávaly HOLÝ STAVOVÝ KÓD:
 *
 *     scripts/stack-health.sh:139   expected_codes="${3:-200}" … [[ "$http_code" == "$code" ]]
 *     scripts/smoke-routing.sh:76   [[ ",$want," == *",$code,"* ]]
 *     scripts/check-infra.mjs:133   isOk = r.status >= 200 && r.status < 400
 *
 * Na hostu se search doménou s wildcardem je to slabé: neznámé jméno se přeloží
 * na síťovou appliance a ta odpoví přesměrováním. Kdo čeká „200,302", dostane
 * 302 od appliance a napíše ✓.
 *
 * Tenhle CLI wrapper je JEDINÝ způsob, jak se shell k tomu verdiktu dostane —
 * kurátorovaný nárok (cesta + kódy) si volající přináší, ale diskvalifikace
 * (odražeč, výchozí 404 edge) drží knihovna a přebít je nelze.
 *
 * POUŽITÍ
 *   node scripts/lib/routing-probe-cli.mjs --url=https://host/health --expect=200
 *   node scripts/lib/routing-probe-cli.mjs --host=admin.x.cz --kind=oauth2 --idp=auth.x.cz
 *   node scripts/lib/routing-probe-cli.mjs --url=… --expect=200,302 --json
 *
 * VÝSTUP (bez --json, jeden řádek, k rozebrání v shellu):
 *   ROUTED|200|
 *   NOTROUTED|302|odpověď nikam neposune (302 → totéž) — to není důkaz o službě
 *   NEZMERENO|000|hostitel není zvenčí měřitelný (vnitřní jméno)
 *
 * NÁVRATOVÝ KÓD: 0 = routed, 1 = neprošlo, 2 = chyba použití, 3 = NEZMĚŘENO.
 * Kódy 1 a 3 jsou VERDIKT, ne selhání nástroje — volající je smí číst jako data.
 *
 * ⛔ PROČ EXISTUJE TŘETÍ VÝROK — naměřeno 2026-08-15:
 *
 *     bash scripts/stack-health.sh --prod   → 8/9 services unhealthy
 *     … nedosažitelné: ENOTFOUND aisha-api.mesh.aisha.internal
 *
 * Skript se z operátorova stroje ptal na MESH jména. Ta se odsud nepřeloží
 * nikdy — ať stack žije, nebo ne. „Nezměřeno" se tím tlačilo do „nemocné"
 * a verdikt byl červený bez ohledu na skutečnost. Sonda má proto tři výroky,
 * ne dva: žije / nežije / odsud změřit nejde.
 */
import { probeRoute, scopeProbable } from "./routing-probe.mjs";

function arg(name, fallback = null) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const url = arg("url");
let host = arg("host");
let path = arg("path");
let scheme = arg("scheme", "https");

if (url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    console.error(`routing-probe-cli: nečitelná --url: ${url} (${e?.message ?? e})`);
    process.exit(2);
  }
  host = u.host; // včetně portu — sonda se ptá přesně tam, kam volající mířil
  path = `${u.pathname}${u.search}`;
  scheme = u.protocol.replace(":", "");
}

if (!host) {
  process.stderr.write("routing-probe-cli: chybí --url nebo --host\n");
  process.exit(2);
}

const kind = arg("kind", "http");
const expectRaw = arg("expect");
// Prázdný `--expect=` je ZÁMĚR („žádný nárok, suď podle druhu"), ne nula kódů:
// jinak by `--expect=` tiše znamenalo „nic neprojde".
const expect = expectRaw
  ? expectRaw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n))
  : null;
const timeoutMs = parseInt(arg("timeout-ms", "10000"), 10);

const headers = {};
for (const a of process.argv) {
  if (!a.startsWith("--header=")) continue;
  const raw = a.slice("--header=".length);
  const i = raw.indexOf(":");
  if (i > 0) headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
}

// STANOVISKO: hostitel, který se z principu zvenčí nepřekládá (vnitřní TLD,
// mesh jméno, sentinel), NENÍ nemocný — jen se odsud měřit nedá. Zamlčet to
// znamená vyrobit červenou tam, kde není nález.
const internalTld = arg("internal-tld", process.env.INTERNAL_TLD || "");
const merilne = scopeProbable([host.replace(/:\d+$/, "")], internalTld ? { internalTld } : {});
if (merilne.length === 0) {
  const zprava = "hostitel není zvenčí měřitelný (vnitřní jméno) — verdikt je NEZMĚŘENO, ne nemocný";
  if (flag("json")) {
    process.stdout.write(`${JSON.stringify({ host, kind, skipped: true, routed: false, reason: zprava })}\n`);
  } else {
    process.stdout.write(`NEZMERENO|000|${zprava}\n`);
  }
  process.exit(3);
}

// Deklarovaná tvář IdP: je-li známa, přihlašovací tok se ověří CÍLEM, ne jen
// tím, že vede „někam jinam". Prázdná hodnota znamená „neznám" — a pak se
// netvrdí nic, místo aby se tvrdilo špatně.
const idpHost = arg("idp", "") || null;

const r = await probeRoute(host, kind, { timeoutMs, scheme, path, expect, headers, idpHost });

if (flag("json")) {
  process.stdout.write(`${JSON.stringify(r)}\n`);
} else {
  process.stdout.write(`${r.routed ? "ROUTED" : "NOTROUTED"}|${r.status ?? "000"}|${r.reason ?? ""}\n`);
}
process.exit(r.routed ? 0 : 1);
