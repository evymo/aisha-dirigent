#!/usr/bin/env node
/**
 * gen-mesh-ingress.mjs — Caddyfile pro mesh-ingress z KATALOGU, ne z ruky.
 *
 * PROČ (2026-07-29)
 * ----------------
 * mesh-ingress mapoval PORT → jedna pevná doména:
 *
 *     :8080 → Host: {$N8N_DOMAIN}
 *     :8081 → Host: {$STUDIO_DOMAIN_DIRECT}
 *     :3001 → Host: {$API_DOMAIN}
 *
 * Port byl tedy směrovací klíč, takže dvě služby na jednom portu se vylučovaly.
 * Změřeno: katalog chce na `:8080` imgproxy, ručně dopsaný blok tam má n8n —
 * konflikt, který ručním přemapováním jen přeskočí na jiný port.
 *
 * Řešení je rozlišovat podle `Host`, ne podle portu: mesh jméno je v Host
 * hlavičce, takže na jednom portu může poslouchat libovolný počet služeb.
 * Konflikt tím přestane existovat jako kategorie.
 *
 * A protože jména i porty JSOU v katalogu (`internal_url`, `internal_endpoints`),
 * dá se celý Caddyfile odvodit. Ručně udržovaný seznam by se rozešel s katalogem
 * — což je třída chyb, na kterou tenhle repozitář už doplatil několikrát.
 *
 * ČTE, NEMĚNÍ (bez `--write`). Výstup jde na stdout, aby šel porovnat.
 *
 * Použití:
 *   node scripts/gen-mesh-ingress.mjs --service core
 *   node scripts/gen-mesh-ingress.mjs --service core --json
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopology, formatShellExports } from "./lib/derive-domains.mjs";
import { trustedProxies } from "./lib/derive-subnets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const SERVICE = arg("--service") ?? "core";
const JSON_OUT = process.argv.includes("--json");

/**
 * Jména → cíl, seskupené podle portu.
 *
 * Zdrojem je `<ID>_MESH_INGRESS_ROUTES` z DERIVACE — tedy přesně ta proměnná,
 * kterou dostane ingress v compose. Dřív se tu katalog četl podruhé a stavěla
 * se tabulka nezávisle; dvě odvození téhož se ale rozejdou, a taky se rozešla:
 * ingress vracel 421 na vlastní veřejný provoz, protože znal jen mesh jména,
 * kdežto tenhle skript se tvářil v pořádku. Teď mají jeden vstup a lišit se
 * můžou nanejvýš formátováním.
 */
export function routesFor(serviceId, topo) {
  if (!topo.services?.[serviceId]) throw new Error(`služba '${serviceId}' není v topologii`);
  const key = `${serviceId.toUpperCase().replace(/-/g, "_")}_MESH_INGRESS_ROUTES`;
  const line = formatShellExports(topo).split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`derivace nevydala ${key} — '${serviceId}' nemá co směrovat`);

  const byPort = new Map();
  for (const route of line.slice(key.length + 1).split(";")) {
    const [port, hosts, target] = route.split("|");
    if (!port || !hosts || !target) continue;
    const p = Number(port);
    if (!byPort.has(p)) byPort.set(p, []);
    byPort.get(p).push({ host: hosts.split(","), target });
  }
  return byPort;
}

function caddyfile(byPort) {
  const out = [];
  // ⛔ NAMĚŘENO 2026-08-31: brána viděla `x-forwarded-for` s JEDINÝM prvkem —
  // adresou svého souseda (`100.126.250.10`, mesh-router edge). To je podpis
  // NAHRAZENÍ, ne řetězu: Caddy bez `trusted_proxies` příchozí hlavičce
  // nedůvěřuje a přepíše ji adresou toho, kdo se právě připojil. Každý náš skok
  // tak řetěz zahodil a klientská adresa se k dveřím nedostala NIKDY —
  // `enforce` by zamkl i majitele.
  //
  // Seznam se ODVOZUJE ze `lib/derive-subnets.mjs`, ať má jeden domov.
  //
  // To „až ten rozsah někdo DORUČÍ", co tu stálo, se 2026-09-02 vyřešilo jinak,
  // než jak to tehdejší poznámka formulovala: nedoručuje se ROZSAH, ale VÝČET
  // peerů (`MESH_PEER_IPS` z discovery). Rozsah 100.64.0.0/10 je CGNAT
  // operátorů — důvěřovat mu znamená důvěřovat mobilům, ne jen vlastní síti.
  out.push(`{`);
  out.push(`  servers {`);
  out.push(`    trusted_proxies static ${trustedProxies(process.env.MESH_PEER_IPS ?? "").join(" ")}`);
  out.push(`  }`);
  out.push(`}`);
  out.push(``);
  for (const [port, routes] of [...byPort].sort((a, b) => a[0] - b[0])) {
    out.push(`:${port} {`);
    out.push(`  handle /__mesh_health {`);
    out.push(`    respond "ok" 200`);
    out.push(`  }`);
    for (const r of routes) {
      // Rozlišení podle Host — proto na jednom portu smí být víc služeb.
      // `host` je SEZNAM: jedna služba se jmenuje různě podle toho, kudy se k ní
      // jde (mesh jméno, veřejná doména, jméno upstreamu od edge). Matcher se
      // pojmenuje podle prvního, protože je to jen štítek.
      const hosts = Array.isArray(r.host) ? r.host : String(r.host).split(",");
      const name = hosts[0].split(".")[0].replace(/-/g, "_");
      out.push(`  @${name} host ${hosts.join(" ")}`);
      out.push(`  handle @${name} {`);
      out.push(`    reverse_proxy http://${r.target}`);
      out.push(`  }`);
    }
    // Bez shody se NEHÁDÁ: 421 říká volajícímu, že Host sem nepatří. Tiché
    // přeposlání na "první" službu by z chybného jména udělalo funkční požadavek
    // na cizí data.
    out.push(`  handle {`);
    out.push(`    respond "mesh-ingress: Host nepatří na tento port" 421`);
    out.push(`  }`);
    out.push(`}`);
  }
  return out.join("\n");
}

const topo = buildTopology({ meshEnabled: true });
const byPort = routesFor(SERVICE, topo);

if (JSON_OUT) {
  console.log(JSON.stringify(
    [...byPort].map(([port, routes]) => ({ port, routes })), null, 2));
} else {
  console.log(caddyfile(byPort));
}
