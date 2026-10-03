#!/usr/bin/env node
/**
 * Regeneruje ráčnu `src/tests/gates/manifest-coverage.baseline.json`.
 *
 * Verdikt má JEDNOHO vlastníka — `manifestCoverageOffenders` v derive-domains.mjs.
 * Druhá implementace by se rozešla a ten rozchod by se četl jako pokrok (týž
 * důvod je zapsaný v scripts/lib/mesh-conformance.mjs).
 *
 * Měří se přes VŠECHNY manifesty v `coolify/manifests/` proti jejich profilu,
 * protože baseline je globální. Instanční manifesty z privátního overlaye se
 * NEMĚŘÍ: ty patří instanci, ne repu.
 *
 *   node scripts/gen-manifest-coverage-baseline.mjs           # jen vypíše
 *   node scripts/gen-manifest-coverage-baseline.mjs --write   # zapíše
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopology, manifestCoverageOffenders } from "./lib/derive-domains.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ. Nástroj umí zapisovat
// (`--write`); překlep nebo slepený argument (zsh bez dělení na slova) by jinak
// tiše spadl do režimu „jen vypíše" a operátor by čekal zápis, který nenastal —
// nebo naopak. Registr se drží U PARSOVÁNÍ (vzor: scripts/aisha-redeploy.mjs);
// hlídá brána neznamy-prepinac-neni-vychozi-chovani.
const ZNAME_PREPINACE = new Set(["--write", "--help", "-h"]);
{
  const argv = process.argv.slice(2);
  const nezname = argv.filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("gen-manifest-coverage-baseline — [--write]; vyžaduje AISHA_PROFILE");
    process.exit(0);
  }
  if (nezname.length) {
    console.error(`gen-manifest-coverage-baseline: neznámý přepínač: ${nezname.join(" ")}`);
    process.exit(2);
  }
}
const BASELINE = join(ROOT, "src/tests/gates/manifest-coverage.baseline.json");
const MANIFESTY = join(ROOT, "coolify/manifests");
// ⛔ ŽÁDNÝ DOSAZENÝ LITERÁL. `|| "cloud-multi"` by HÁDAL fakt o světě: baseline
// vygenerovaná proti jinému profilu, než jaký operátor zamýšlel, tiše zapíše
// cizí dluh — a ráčna pak tvrdí, že hlídá něco, co nezměřila. Chybějící hodnota
// má selhat TADY, ne o tři vrstvy dál. (Hlídá brána zadny-fallback-nad-identitou,
// která tenhle řádek zachytila hned při prvním běhu.)
const PROFIL = (process.env.AISHA_PROFILE ?? "").trim();
if (!PROFIL) {
  console.error("gen-manifest-coverage-baseline: chybí AISHA_PROFILE.");
  console.error("  Baseline se generuje PROTI KONKRÉTNÍMU profilu — bez něj není co měřit.");
  console.error("  Např.: AISHA_PROFILE=cloud-multi node scripts/gen-manifest-coverage-baseline.mjs --write");
  process.exit(1);
}

const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf8"));
const sluzby = katalog.services ?? katalog;
const topo = buildTopology({ profileId: PROFIL });

const bezKatalogu = new Set();
const mimoProfil = new Set();
for (const f of readdirSync(MANIFESTY).filter((f) => f.endsWith(".manifest"))) {
  if (f.startsWith("_")) continue; // šablona
  const r = manifestCoverageOffenders(topo, readFileSync(join(MANIFESTY, f), "utf8"), sluzby);
  r.bezKatalogu.forEach((x) => bezKatalogu.add(x));
  r.mimoProfil.forEach((x) => mimoProfil.add(x));
}

const stara = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const nova = {
  ...stara,
  bez_katalogu: [...bezKatalogu].sort(),
  mimo_profil: [...mimoProfil].sort(),
};

const zmena = (a = [], b = []) => ({
  pribylo: b.filter((x) => !a.includes(x)),
  ubylo: a.filter((x) => !b.includes(x)),
});
const zk = zmena(stara.bez_katalogu, nova.bez_katalogu);
const zp = zmena(stara.mimo_profil, nova.mimo_profil);

console.log(`profil=${PROFIL}  bez katalogu: ${nova.bez_katalogu.length}  ·  mimo profil: ${nova.mimo_profil.length}`);
for (const x of [...zk.pribylo, ...zp.pribylo]) console.log(`  ⚠️ nově mimo: ${x}`);
for (const x of [...zk.ubylo, ...zp.ubylo]) console.log(`  ✅ splaceno: ${x}`);

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE, JSON.stringify(nova, null, 2) + "\n");
  console.log(`\nzapsáno → ${BASELINE}`);
} else {
  console.log("\n(bez --write se nic nezapisuje)");
}
