/**
 * Brána: výčet mesh peerů má JEDEN výklad — a MESH_PEER_IPS nevzniká z klíčů.
 *
 * ⛔ NAMĚŘENO 2026-09-15 (instance s meshem). Discovery vrátil 29 peerů,
 * `MESH_PEER_IPS` jich neslo 21. `aisha-redeploy.mjs` četl řádky
 * `<ROLE>_MESH_IP=ip` do `Map` a důvěru poskládal z jejích hodnot:
 *
 *   · KOLIZE: `backend-mesh-router` i `experimental-mesh-router` → týž klíč
 *     `MESH_ROUTER_MESH_IP`; připojený mesh-router druhého stroje z důvěry
 *     (GATEWAY_TRUSTED_PROXIES) vypadl.
 *   · DUPLICITA: po re-enrollmentu drží management víc záznamů téhož jména;
 *     vítěz podle pořadí API — ráno odpojený edge, odpoledne živý.
 *
 * Tatáž vada („poslední v pořadí vyhrává") byla ve třech čtenářích zvlášť:
 * redeploy, mesh DNS (netbird-dns-provision) a výchozí výstup discovery.
 * Mesh sync měl správnou volbu — ale jen pro sebe.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   1. Každý, kdo ZAPISUJE `MESH_PEER_IPS`, ji skládá z výčtu (`mnozinaPeerIps`),
 *      ne z hodnot mapy klíčů. Univerzum = soubory, které ten klíč zapisují.
 *   2. Žádný čtenář výčtu neparsuje řádky `…_MESH_IP=` do mapy — to je přesně
 *      konstrukce, která kolize a duplicity schová.
 *   3. Každý, kdo z výčtu vybírá peera PODLE JMÉNA, bere volbu z
 *      `lib/mesh-peers.mjs`. Univerzum = soubory, které spouštějí discovery
 *      nebo čtou tělo `/api/peers`; výjimka je jen čtenář, který podle jména
 *      nevybírá (a to se tu ověří, ne slíbí).
 *   4. Výchozí výstup discovery vydá každý klíč nejvýš jednou.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** Zdrojáky pod scripts/ a services/ (bez testů a node_modules). */
function zdrojaky(): string[] {
  const out: string[] = [];
  const projdi = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f === "dist" || f.startsWith(".")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) projdi(p);
      else if (/\.(mjs|js|ts|sh)$/.test(f) && !/\.test\.|\.spec\./.test(f)) out.push(p);
    }
  };
  projdi(join(ROOT, "scripts"));
  projdi(join(ROOT, "services"));
  return out;
}

/** Text bez řádkových komentářů — komentář není chování. */
const bezKomentaru = (t: string) =>
  t
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*|#)/.test(r))
    .join("\n");

const LIB = "scripts/lib/mesh-peers.mjs";
const DISCOVERY = "scripts/netbird-peer-discover.mjs";

describe("mesh peery — jeden výklad výčtu", () => {
  const soubory = zdrojaky().map((p) => ({ cesta: relative(ROOT, p), text: bezKomentaru(readFileSync(p, "utf-8")) }));

  test("univerzum není prázdné (jinak brána nic neměří)", () => {
    expect(soubory.length).toBeGreaterThan(50);
    expect(soubory.some((s) => s.cesta === LIB), `${LIB} chybí`).toBe(true);
  });

  test("kdo zapisuje MESH_PEER_IPS, skládá ji z výčtu (mnozinaPeerIps), ne z klíčů", () => {
    const zapisovatele = soubory.filter((s) => /MESH_PEER_IPS=\$\{/.test(s.text));
    expect(zapisovatele.length, "nikdo MESH_PEER_IPS nezapisuje — detekce se rozešla se skutečností").toBeGreaterThan(0);
    const vadni = zapisovatele
      .filter((s) => !/mnozinaPeerIps\(/.test(s.text) || /\.values\(\)\]\s*\.sort\(\)/.test(s.text))
      .map((s) => s.cesta);
    expect(
      vadni,
      "MESH_PEER_IPS se musí skládat z celého výčtu (lib/mesh-peers.mjs mnozinaPeerIps). " +
        "Hodnoty mapy klíčů <ROLE>_MESH_IP schovají kolize prefixů i duplicitní jména — " +
        "2026-09-15 tak z důvěry vypadl připojený mesh-router.",
    ).toEqual([]);
  });

  test("nikdo neparsuje řádky …_MESH_IP= do mapy", () => {
    const vadni = soubory
      .filter((s) => s.cesta !== LIB)
      .filter((s) => /_MESH_IP\)=\(\\S\+\)/.test(s.text) && /\.set\(m\[1\]/.test(s.text))
      .map((s) => s.cesta);
    expect(
      vadni,
      "Mapa z řádků KEY=ip bere POSLEDNÍ výskyt klíče — tedy pořadí z API. " +
        "Čti `netbird-peer-discover.mjs --json` a vykládej přes lib/mesh-peers.mjs.",
    ).toEqual([]);
  });

  test("kdo z výčtu vybírá peera podle jména, bere volbu z lib/mesh-peers.mjs", () => {
    const ctenari = soubory.filter(
      (s) =>
        s.cesta !== LIB &&
        s.cesta !== DISCOVERY &&
        /\.(mjs|js|ts)$/.test(s.cesta) &&
        (/netbird-peer-discover\.mjs/.test(s.text) || /\/api\/peers`[\s\S]{0,400}?\.json\(\)/.test(s.text)),
    );
    expect(ctenari.length, "žádný čtenář výčtu — detekce se rozešla se skutečností").toBeGreaterThanOrEqual(3);

    // Jen objekty PEERŮ (`p` / `peer`) — `.name` appek Coolify, DNS skupin
    // a zón se stejně jmenuje, ale s volbou peera nemá nic společného.
    const PEER = String.raw`\b(?:p|peer)\??\.(?:hostname|name)\b`;
    const vybiraPodleJmena = (t: string) =>
      new RegExp(String.raw`\.set\([^\n]*${PEER}|${PEER}[^\n]{0,80}\.set\(|\.find\([^\n]*${PEER}\s*===`).test(t);
    // Import knihovny NENÍ výjimka: mutační zkouška 2026-09-15 ukázala, že čtenář
    // s importem, ale s vlastní volbou `map.set(p.name, …)`, by prošel.
    const vadni = ctenari.filter((s) => vybiraPodleJmena(s.text)).map((s) => s.cesta);
    expect(
      vadni,
      "Tenhle čtenář vybírá peera podle jména vlastní logikou. Po re-enrollmentu drží " +
        "management víc záznamů téhož jména a volba podle pořadí pošle provoz na odpojený " +
        "peer (mesh DNS 2026-09-15: „no route to host“). Použij nejlepsiPeerPodleJmena / meshIpKlice.",
    ).toEqual([]);

    // Sonda: detekce „vybírá podle jména“ musí chytit tvar, který tu opravdu byl.
    expect(vybiraPodleJmena('for (const p of peers) if (p?.name && p?.ip) map.set(String(p.name).trim(), ip);')).toBe(true);
    expect(vybiraPodleJmena("const peer = peers.find((p) => p.hostname === hostnameFilter);")).toBe(true);
    // …a nesmí chytit cizí `.name` (appky, DNS skupiny), jinak by brána lhala.
    expect(vybiraPodleJmena("if (a.name?.startsWith(X)) map.set(a.name, a);")).toBe(false);
    expect(vybiraPodleJmena('const allGroup = groups.find((g) => g.name === "All");')).toBe(false);
  });

  test("redeploy, mesh DNS a mesh sync výklad opravdu používají", () => {
    const podle = (c: string) => soubory.find((s) => s.cesta === c)?.text ?? "";
    expect(podle("scripts/aisha-redeploy.mjs")).toMatch(/import \{[^}]*mnozinaPeerIps[^}]*\} from "\.\/lib\/mesh-peers\.mjs"/);
    expect(podle("scripts/aisha-redeploy.mjs"), "redeploy čte celý výčet (JSON)").toMatch(/netbird-peer-discover\.mjs"\), "--json"\]/);
    expect(podle("scripts/netbird-dns-provision.mjs"), "volání, ne jen import").toMatch(/nejlepsiPeerPodleJmena\(/);
    expect(podle("scripts/coolify-mesh-sync.mjs"), "volání, ne jen import").toMatch(/nejlepsiPeerPodleJmena\(/);
  });

  test("výchozí výstup discovery vydá každý klíč nejvýš jednou (meshIpKlice)", () => {
    const d = soubory.find((s) => s.cesta === DISCOVERY)?.text ?? "";
    expect(d).toMatch(/meshIpKlice\(peers\)/);
    expect(d, "řádek za každého peera = duplicitní klíče").not.toMatch(/for \(const peer of peers\)[\s\S]{0,200}_MESH_IP|envKeyForHostname\(hostname\)\}=\$\{peer\.ip\}/);
  });
});
