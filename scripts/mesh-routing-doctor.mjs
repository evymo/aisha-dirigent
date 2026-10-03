#!/usr/bin/env node
/**
 * mesh-routing-doctor — hlídá, že veřejná trasa má vnitřní cíl, který někdo
 * doopravdy vyrábí, a že vnitřní jméno odpovídá NAŠÍ identitou.
 *
 * ⛔ PROČ VZNIKL (naměřeno 2026-08-21 na riqi). Čtyři veřejné trasy vracely 502
 * s certifikátem CIZÍ instance a nikdo to nespojoval s DNS:
 *
 *     ingest.<tld>  → https://<prefix>-ingest.mesh.<mesh-tld>   (edge-proxy)
 *     <prefix>-ingest.mesh.<mesh-tld>                            → NXDOMAIN
 *     ...ale NXDOMAIN se tu NEDĚJE: router doplní vyhledávací doménu
 *     s wildcardem, jméno se přeloží na sdílenou veřejnou IP, SNI nesedí
 *     na žádný vhost a nabídne se výchozí certifikát cizí instance.
 *
 * Tři nezávislé díry se přitom tvářily stejně (502) a žádná neměla měřidlo:
 *   1. edge směruje na jméno, které TOPOLOGIE VŮBEC NEDEKLARUJE
 *      (`local-ingest`, `potok` nebyly v resolveru, přesto pro ně existovaly
 *      `*_DOMAIN_PUBLIC` i `*_UPSTREAM` a edge je servíroval);
 *   2. jméno topologie zná, ale NEMÁ ZÁZNAM v mesh DNS
 *      (provisioner ho neuměl vyřešit — chyběl peer i alias);
 *   3. jméno se přeloží, ale NA CIZÍ IDENTITU (wildcard).
 *
 * ZÁKON, který tenhle nástroj měří: vnitřní jméno buď ukazuje na nás, nebo
 * MUSÍ SELHAT. Tiché přesměrování na cizí stroj je horší než výpadek —
 * vypadá to jako porucha protějšku a hledá se celé dny jinde.
 *
 * Read-only. Exit 0 = čisto, 1 = nález, 2 = nelze změřit (a to je taky nález,
 * jen jiného druhu: sonda musí umět odpovědět „nevím", ne mlčet).
 *
 * Usage:
 *   node scripts/mesh-routing-doctor.mjs            # text
 *   node scripts/mesh-routing-doctor.mjs --json     # pro CI/gate
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";
import { porovnej } from "./lib/razeni.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");
const nalezy = [];
const pridej = (uroven, kod, text, coStim) => nalezy.push({ uroven, kod, text, coStim });

function envSouboru() {
  const f = join(ROOT, ".env.coolify");
  if (!existsSync(f)) return null;
  const map = {};
  for (const r of readFileSync(f, "utf-8").split("\n")) {
    const m = r.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) map[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return map;
}

/** Veřejné trasy, které edge servíruje: <PREFIX>_DOMAIN_PUBLIC + <PREFIX>_UPSTREAM*. */
function verejneTrasy(env) {
  const trasy = [];
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^([A-Z0-9_]+)_DOMAIN_PUBLIC$/);
    if (!m || !v) continue;
    const role = m[1];
    const up =
      env[`${role}_UPSTREAM`] || env[`${role}_UPSTREAM_MESH`] || env[`${role}_UPSTREAM_PUBLIC`] || "";
    trasy.push({ role, domena: v, upstream: up });
  }
  return trasy.sort((a, b) => porovnej(a.role, b.role));
}

/** Jména, která topologie DEKLARUJE jako vnitřní mesh adresy. */
function deklarovanaMeshJmena(env) {
  try {
    // ⛔ RESOLVERU SE MUSÍ PŘEDAT PROSTŘEDÍ INSTANCE. Naměřeno při vzniku
    // tohohle nástroje: bez něj spadl na profil `cloud-single` a referenční
    // hodnoty z příkladu — a měřidlo pak hlásilo jako NEDEKLAROVANÉ i jména,
    // která topologie zná. Falešný nález je horší než žádný: pošle člověka
    // opravovat něco, co je v pořádku.
    // ⛔ PŘEDÁVÁ SE CELÉ PROSTŘEDÍ, NE VYBRANÉ KLÍČE. Vybraný seznam tu byl a
    // selhal DVAKRÁT za sebou, pokaždé jinak: nejdřív chyběly TLD (resolver
    // spadl na cizí profil), pak opt-in vlajky `provision_when_env`
    // (INGEST_BUNDLE_GIT_URL, POTOK_ENABLED) — a služby, které instance
    // NASAZENÉ MÁ, se tvářily jako nedeklarované.
    //
    // Ruční seznam je přesně ta vada, kterou tenhle nástroj hlídá u jiných:
    // deklarace, která se rozejde se skutečností. Univerzum se NEPÍŠE.
    const predane = { ...env };
    const r = execFileSync(process.execPath, [join(ROOT, "scripts/lib/derive-domains.mjs"), "--json"], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, ...predane, MESH_ENABLED: "true" },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = r;
    const topo = JSON.parse(out);
    const set = new Set();
    for (const svc of Object.values(topo.services || {})) {
      for (const u of svc.urls?.internal || []) if (u.url) set.add(u.url);
    }
    return set;
  } catch (e) {
    pridej(
      "nezmereno",
      "topologie-nedostupna",
      `Resolver topologie neodpověděl: ${String(e.message).split("\n")[0]}`,
      "Nejčastěji chybí AISHA_INSTANCE_CONFIG_DIR (overlay instance). Bez topologie\n" +
        "  nelze říct, které vnitřní jméno je legitimní — a to je nález, ne 'čisto'.",
    );
    return null;
  }
}

/** Adresy, které patří NÁM: mesh rozsah peerů + docker bridge rozsahy instance. */
function jeNase(ip, meshPrefix) {
  if (!ip) return false;
  if (meshPrefix && ip.startsWith(meshPrefix)) return true;
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

async function main() {
  const env = envSouboru();
  if (!env) {
    pridej("nezmereno", "env-chybi", ".env.coolify nenalezen — nelze zjistit, co edge servíruje.",
      "Spusť to v kořeni instance, kde vygenerovaný .env.coolify leží.");
    return hotovo();
  }

  const MESH_TLD = env.MESH_TLD || "";
  if (!MESH_TLD) {
    pridej("nezmereno", "mesh-tld-chybi", "MESH_TLD není v .env.coolify — nepoznám vnitřní jméno od veřejného.",
      "MESH_TLD vydává generate-secrets; jeho absence znamená rozbitý SoT.");
    return hotovo();
  }

  // Mesh rozsah odvodíme z peerů, ne z literálu: adresní plán je vlastnost
  // nasazení, ne konstanta v kódu.
  const meshPrefix = (env.CORE_MESH_IP || "").split(".").slice(0, 2).join(".");
  if (!meshPrefix) {
    pridej("nalez", "core-mesh-ip-prazdne",
      "CORE_MESH_IP je prázdné — mesh-router postaví DNAT bez cíle a api vrátí 502.",
      "CO S TÍM: node scripts/coolify-mesh-sync.mjs --apply (potřebuje funkční peer discovery),\n" +
        "  pak přenasadit edge. NEDĚLEJ: nedosazuj adresu ručně, objevovaná hodnota nemá default.");
  }

  const deklarovana = deklarovanaMeshJmena(env);
  const trasy = verejneTrasy(env);
  if (trasy.length === 0) {
    pridej("nezmereno", "univerzum-prazdne",
      "Nenašel jsem ani jednu veřejnou trasu (*_DOMAIN_PUBLIC) — měřidlo by tiše zezelenalo.",
      "Ověř, že .env.coolify je vygenerovaný a ne prázdný.");
    return hotovo();
  }

  for (const t of trasy) {
    if (!t.upstream) continue;
    // Role, jejíž provoz brána přesměruje jinam, na svůj mesh upstream NESAHÁ.
    // Měřit deklaraci cíle, který se nepoužije, je nález o ničem.
    if (t.role === "EXTRANET" && env.EXTRANET_AUTH_GATE === "1") continue;
    const host = t.upstream.replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "");
    if (!host.endsWith(MESH_TLD)) continue; // nevnitřní cíl řeší jiná měřidla

    // 1) deklaruje ho vůbec někdo?
    if (deklarovana && !deklarovana.has(host)) {
      pridej("nalez", "cil-neni-deklarovan",
        `${t.domena} → ${host} — tohle jméno TOPOLOGIE NEDEKLARUJE (role ${t.role}).`,
        `CO S TÍM: buď službu doplň do config/services.json (+ profil instance), ať ji\n` +
          `  resolver zná a DNS provisioning jí vyrobí záznam, nebo tu veřejnou trasu\n` +
          `  zruš. Trasa na nedeklarované jméno NIKDY nedostane záznam a v prostředí\n` +
          `  s wildcardem tiše skončí u cizího stroje.`);
    }

    // 2) na co se to doopravdy přeloží
    // ⛔ TICHÝ `catch` TU NESMÍ BÝT. „Nepřeložilo se" a „resolver je rozbitý"
    // vypadají v prázdném poli stejně — a měřidlo, které to nerozliší, hlásí
    // klid i ve chvíli, kdy neměřilo nic.
    let adresy = [];
    try {
      adresy = (await dns.resolve4(host)).slice(0, 3);
    } catch (e) {
      const kod = e && e.code;
      if (kod !== "ENOTFOUND" && kod !== "ENODATA" && kod !== "NXDOMAIN") {
        pridej("nezmereno", "resolver-selhal",
          `${host}: dotaz na DNS selhal (${kod || e.message}) — nevím, kam to jméno míří.`,
          "Bez odpovědi nelze rozhodnout, jestli jméno ukazuje na nás, nebo na cizí stroj.\n" +
            "  Opakuj z místa, kde resolver funguje.");
      }
      adresy = [];
    }
    if (adresy.length === 0) {
      pridej("info", "jmeno-neresolvuje",
        `${host} se odsud nepřeloží (NXDOMAIN).`,
        "To je SPRÁVNÉ chování pro vnitřní jméno mimo mesh. Nález je opak: kdyby\n" +
          "  odpovědělo, znamená to wildcard nebo cizí záznam.");
      continue;
    }
    const cizi = adresy.filter((ip) => !jeNase(ip, meshPrefix));
    if (cizi.length) {
      pridej("nalez", "vnitrni-jmeno-odpovida-cizi-identitou",
        `${host} → ${cizi.join(", ")} — to NENÍ adresa uvnitř instance.`,
        "CO S TÍM: vnitřní jméno se přeložilo přes wildcard vyhledávací domény na cizí\n" +
          "  stroj. Buď mu vyrob záznam (netbird-dns-provision), nebo naprav resolver, aby\n" +
          "  neexistující jméno SELHALO. NEDĚLEJ: neřeš to přidáním -k ani přepnutím na\n" +
          "  veřejnou tvář — tím se jen schová, že provoz chodí jinam.");
    }
  }

  return hotovo();
}

function hotovo() {
  const nalezu = nalezy.filter((n) => n.uroven === "nalez").length;
  const nezmereno = nalezy.filter((n) => n.uroven === "nezmereno").length;
  if (JSON_OUT) {
    console.log(JSON.stringify({ nalezu, nezmereno, nalezy }, null, 2));
  } else {
    console.log(`\nmesh-routing-doctor — nálezů: ${nalezu}, nezměřeno: ${nezmereno}\n`);
    for (const n of nalezy) {
      const znak = n.uroven === "nalez" ? "✗" : n.uroven === "nezmereno" ? "?" : "·";
      console.log(`${znak} [${n.kod}] ${n.text}`);
      if (n.coStim) console.log(`  ${n.coStim.replace(/\n/g, "\n  ")}\n`);
    }
    if (!nalezy.length) console.log("· žádný nález — každá veřejná trasa míří na deklarované vnitřní jméno.\n");
  }
  process.exit(nalezu > 0 ? 1 : nezmereno > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(`mesh-routing-doctor selhal: ${e.message}`);
  process.exit(2);
});
