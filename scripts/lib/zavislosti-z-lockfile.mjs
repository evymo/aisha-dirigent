/**
 * zavislosti-z-lockfile.mjs — nainstalovat JEN to, co obraz potřebuje, a PŘESNĚ v tom,
 * co drží lockfile monorepa.
 *
 * ⛔ PROČ (naměřeno 2026-09-23, <fork>-core, nasazení pc2i6yts…)
 * `Dockerfile.plugin-publish-init` dělal `npm install --no-save esbuild@V` v adresáři
 * s KOŘENOVÝM `package.json` monorepa, ale bez `package-lock.json`. npm tedy znovu
 * resolvoval CELÝ strom monorepa na nejnovější verze v rozsazích a trefil se do
 * okamžiku, kdy Sentry vydával 10.75.3 (vyšel 14:06:21Z, build padl 14:06:24Z):
 *     npm error notarget No matching version found for @sentry/core@10.75.3.
 * Lockfile přitom držel 10.55.0. Compose je jeden celek → nenasadilo se celé jádro.
 *
 * ⭐ CO SE INSTALUJE A ODKUD JE ČÍSLO (jeden domov každého čísla):
 *   · nástroje publikace (esbuild, minio) — ROZSAH z kořenového `package.json`,
 *     rozřešená verze z `package-lock.json`;
 *   · závislosti pluginů — PŘESNÁ verze z `plugins/<slug>/manifest.json`
 *     (`dependencies`). Build je BALÍ (esbuild `bundle: true`), takže musí ležet
 *     v `node_modules` při buildu. Dřív je tam dostal náhodou celý strom monorepa;
 *     instalace jen esbuild+minio by tcars-fleet a webdispecink-fleet (fast-xml-parser)
 *     tiše vyřadila z katalogu.
 * Z lockfile se vezme UZAVŘENÁ podmnožina (balík + všechny jeho závislosti po
 * pravidlech rozřešení node) a `npm ci` ji nainstaluje s kontrolou integrity —
 * nic dalšího se neresolvuje. Neshoda nebo chybějící položka = STOP, nic se neodhaduje.
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "./cli-entry.mjs";

/** Umístění závislosti `dep` viděné z balíku na `odkud` (pravidla rozřešení node_modules). */
export function najdi(baliky, odkud, dep) {
  let zaklad = odkud;
  for (;;) {
    const kandidat = `${zaklad ? `${zaklad}/` : ""}node_modules/${dep}`;
    if (baliky[kandidat]) return kandidat;
    if (!zaklad) return null;
    const i = zaklad.lastIndexOf("/node_modules/");
    zaklad = i >= 0 ? zaklad.slice(0, i) : "";
  }
}

/**
 * Uzavřená podmnožina lockfile pro dané kořenové balíky.
 * @param {{packages: Record<string, any>}} lock  package-lock.json (v2/v3)
 * @param {string[]} koreny  jména balíků na nejvyšší úrovni
 * @returns {Record<string, any>} položky `packages` (bez kořene "")
 */
export function uzaver(lock, koreny) {
  const baliky = lock?.packages;
  if (!baliky || typeof baliky !== "object") throw new Error("lockfile nemá `packages` (potřeba lockfileVersion ≥ 2)");
  const vybrane = {};
  const fronta = [];
  for (const jmeno of koreny) {
    const kde = `node_modules/${jmeno}`;
    if (!baliky[kde]) throw new Error(`lockfile nezná ${jmeno} na nejvyšší úrovni — nejdřív ho deklarujte v monorepu`);
    fronta.push(kde);
  }
  while (fronta.length) {
    const kde = fronta.shift();
    if (vybrane[kde]) continue;
    const polozka = baliky[kde];
    if (polozka.link) throw new Error(`${kde} je odkaz na workspace — do izolované instalace nepatří`);
    const { dev, devOptional, ...bezPriznakuDev } = polozka;
    vybrane[kde] = bezPriznakuDev;
    const povinne = Object.keys(polozka.dependencies ?? {});
    const volitelne = Object.keys(polozka.optionalDependencies ?? {});
    for (const dep of [...povinne, ...volitelne]) {
      const cil = najdi(baliky, kde, dep);
      if (cil) fronta.push(cil);
      else if (!volitelne.includes(dep)) throw new Error(`${kde} potřebuje ${dep}, ale lockfile ho nemá — lockfile je nekonzistentní`);
    }
  }
  return vybrane;
}

/** Závislosti pluginů z manifestů: jméno → přesná verze; rozpor mezi pluginy = STOP. */
export function zavislostiPluginu(manifesty) {
  const out = {};
  for (const { slug, manifest } of manifesty) {
    for (const [jmeno, verze] of Object.entries(manifest?.dependencies ?? {})) {
      if (out[jmeno] && out[jmeno].verze !== verze) {
        throw new Error(`${jmeno}: plugin ${out[jmeno].slug} chce ${out[jmeno].verze}, ${slug} chce ${verze} — jedna instalace neumí obojí`);
      }
      out[jmeno] = { verze: String(verze), slug };
    }
  }
  return out;
}

/**
 * Složí izolovaný projekt: `package.json` + `package-lock.json` jen s tím, co obraz potřebuje.
 * @param {{rootPkg: any, lock: any, nastroje: string[], manifesty: Array<{slug: string, manifest: any}>}} vstup
 */
export function slozProjekt({ rootPkg, lock, nastroje, manifesty }) {
  const zavislosti = {};
  for (const jmeno of nastroje) {
    const rozsah = rootPkg?.dependencies?.[jmeno] ?? rootPkg?.devDependencies?.[jmeno];
    if (!rozsah) throw new Error(`${jmeno} není deklarován v kořenovém package.json — publikace by spadla až za běhu`);
    zavislosti[jmeno] = rozsah;
  }
  for (const [jmeno, { verze, slug }] of Object.entries(zavislostiPluginu(manifesty))) {
    const vLockfile = lock?.packages?.[`node_modules/${jmeno}`]?.version;
    if (vLockfile !== verze) {
      throw new Error(
        `plugin ${slug} deklaruje ${jmeno}@${verze}, lockfile monorepa drží ${vLockfile ?? "NIC"} — ` +
          "sjednoťte verzi (manifest je tvrzení o tom, co se zabalí)",
      );
    }
    if (zavislosti[jmeno] && zavislosti[jmeno] !== verze) throw new Error(`${jmeno}: nástroj i plugin s různou verzí`);
    zavislosti[jmeno] = verze;
  }
  const jmeno = "plugin-publish-zavislosti";
  const pkg = { name: jmeno, private: true, dependencies: zavislosti };
  const packages = { "": { name: jmeno, dependencies: zavislosti }, ...uzaver(lock, Object.keys(zavislosti)) };
  return { pkg, lock: { name: jmeno, lockfileVersion: 3, requires: true, packages } };
}

// CLI: node zavislosti-z-lockfile.mjs <monorepo> <pluginy> <cil> <nástroj…>
//   monorepo: adresář s kořenovým package.json + package-lock.json
//   pluginy:  adresář s plugins/<slug>/manifest.json (v obraze leží jinde než monorepo)
if (isDirectRun(import.meta.url)) {
  const [koren, adresar, cil, ...nastroje] = process.argv.slice(2);
  if (!koren || !adresar || !cil || nastroje.length === 0) {
    process.stderr.write("použití: zavislosti-z-lockfile.mjs <monorepo> <pluginy> <cil> <nástroj…>\n");
    process.exit(2);
  }
  try {
    const cti = (p) => JSON.parse(readFileSync(p, "utf8"));
    // Chybějící adresář pluginů NENÍ „žádné závislosti" — tak by tiše vypadly
    // přesně ty balíky, kvůli kterým se manifesty čtou.
    if (!existsSync(adresar)) throw new Error(`adresář pluginů ${adresar} neexistuje — bez manifestů nevím, co pluginy balí`);
    const manifesty = readdirSync(adresar)
      .filter((slug) => existsSync(join(adresar, slug, "manifest.json")))
      .map((slug) => ({ slug, manifest: cti(join(adresar, slug, "manifest.json")) }));
    const vysledek = slozProjekt({
      rootPkg: cti(join(koren, "package.json")),
      lock: cti(join(koren, "package-lock.json")),
      nastroje,
      manifesty,
    });
    mkdirSync(cil, { recursive: true });
    writeFileSync(join(cil, "package.json"), `${JSON.stringify(vysledek.pkg, null, 2)}\n`);
    writeFileSync(join(cil, "package-lock.json"), `${JSON.stringify(vysledek.lock, null, 2)}\n`);
    const pocet = Object.keys(vysledek.lock.packages).length - 1;
    process.stdout.write(`izolovaná instalace: ${Object.entries(vysledek.pkg.dependencies).map(([j, v]) => `${j}@${v}`).join(", ")} · ${pocet} balíků z lockfile\n`);
  } catch (e) {
    process.stderr.write(`STOP: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
