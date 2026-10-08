#!/usr/bin/env node
/**
 * fetch-locked-package — vezme soubory JEDNOHO balíku přesně podle
 * `package-lock.json`: workspace (`"link": true`) ze zdroje ve stromu,
 * jinak stažením z registru s ověřením proti otisku, který lock nese.
 *
 * ⭐ STAV OD 2026-10-04: `@aisha/extranet-sdk-ui` je WORKSPACE ze submodulu
 * `packages/extranet-sdk` (evymo/aisha-extranet-sdk). Zdroj pravdy je SDK repo
 * připnuté gitlinkem, build nesahá na žádný registr. Historie níž vysvětluje,
 * proč skript existuje a proč ne kopie v repu: ta zůstává v platnosti — submodul
 * kopie NENÍ, je to odkaz na místo, odkud se SDK vydává.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-18)
 *
 * `Dockerfile.keycloak` kopíroval CSS designového jazyka takhle:
 *
 *     COPY packages/design-language/src/styles.css   → funguje
 *     COPY packages/extranet-sdk-ui/styles.css       → ADRESÁŘ NEEXISTUJE
 *     COPY packages/extranet-sdk-ui/adapter.css      → ADRESÁŘ NEEXISTUJE
 *
 * Obě cesty jsou napsané, jako by šlo o balíky téže třídy. Nejsou:
 * `@aisha/design-language` je workspace TOHOTO repa, `@aisha/extranet-sdk-ui`
 * je publikovaný balík z registru (`npm.id3a.cz`, 0.3.1, závislost
 * `apps/workbench-shell`). V gitu má nula souborů a na disku vývojáře leží jen
 * proto, že tam doběhlo `npm install`. Build kontejner takový adresář nemá
 * a `.dockerignore` navíc vyřazuje `node_modules/` — takže se do kontextu
 * nedostane ani nainstalovaná kopie. Build Keycloaku proto padal.
 *
 * PROČ NE KOPIE V REPU
 * Nabízelo se ty dva soubory do repa zkopírovat (a hlídat je `--check` bránou).
 * Byla by to kopie CIZÍHO artefaktu: verzi vydává někdo jiný, takže by se
 * rozcházela tiše a brána by hlídala jen to, že se rozchází stejně na obou
 * stranách. Balík se má VZÍT ODTUD, ODKUD SE VYDÁVÁ.
 *
 * PROČ NE `npm ci`
 * Instalace celého stromu kvůli dvěma souborům CSS by do buildu Keycloaku
 * přitáhla React a několik set balíků. Tenhle skript sáhne jen po tom jednom.
 *
 * CO JE TU ZDROJ PRAVDY
 * `package-lock.json` — verze, adresa i otisk. Žádná verze se tu nepíše ručně,
 * takže se nemůže rozejít s tím, co instaluje zbytek repa. Chybějící záznam,
 * chybějící `integrity` i nesouhlasný otisk jsou TVRDÝ pád: tichý přeskok by
 * vyrobil přihlašovací stránku bez značky a to se pozná až očima, tedy hůř
 * než spadlý build.
 *
 * POVĚŘENÍ: žádné. Čtení `@aisha/*` z hubu je anonymní (změřeno 2026-08-18:
 * HTTP 200 bez tokenu). Kdyby se to změnilo, build spadne na 401 s hláškou —
 * ne potichu. Token se sem NEMÁ dodávat jako build arg: zapsal by se do
 * `docker history`. Správná cesta by byla `--mount=type=secret`, jak to dělá
 * `git_token` v tomtéž Dockerfilu.
 *
 * Použití:
 *   node scripts/build/fetch-locked-package.mjs [--bez-externich-importu] \
 *        <balík> <cílový-adresář> <soubor…>
 *
 * `--bez-externich-importu` odstraní z CSS řádky `@import url("https://…")`.
 * ⛔ Je to VOLBA, ne úklid: takový import znamená, že přihlašovací stránka při
 * každém zobrazení sáhne na cizí server. `@aisha/extranet-sdk-ui@0.3.1` má
 * v `tokens.css` import fontů z Google CDN. Tři důvody, proč na přihlašovací
 * stránce AISHA instance nemá co dělat:
 *   · air-gap je deklarovaný cíl (docs/release/CROSS_STACK_VERDACCIO_MIRROR.md),
 *     a stránka, která čeká na cizí CDN, ho ruší;
 *   · `style-src 'self'` v CSP takový zdroj zablokuje a typografie se nenačte
 *     NIKDE — pád, který se pozná až očima;
 *   · typografii vydává páteř jazyka (`design-language.css`), ne SDK.
 * Kolik řádků odešlo, se VYPÍŠE — tichý zásah do cizího artefaktu by byl horší
 * než ten import.
 *
 * Vypíše do <cílový-adresář>/ požadované soubory z rozbaleného balíku.
 * @module
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const BEZ_EXTERNICH_IMPORTU = argv.includes("--bez-externich-importu");
const [balik, cil, ...soubory] = argv.filter((a) => !a.startsWith("--"));

function padni(zprava) {
  process.stderr.write(`[fetch-locked-package] CHYBA: ${zprava}\n`);
  process.exit(1);
}

if (!balik || !cil || soubory.length === 0) {
  padni("použití: fetch-locked-package.mjs <balík> <cílový-adresář> <soubor…>");
}

const LOCK = "package-lock.json";
if (!existsSync(LOCK)) padni(`${LOCK} není v pracovním adresáři (${process.cwd()}) — bez něj není z čeho odvodit verzi`);

const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const zaznam = lock.packages?.[`node_modules/${balik}`];

if (!zaznam) {
  padni(
    `${LOCK} nemá záznam pro node_modules/${balik}.\n` +
      "  Buď se balík přestal používat (pak smaž i tohle volání), nebo se lock\n" +
      "  rozešel s package.json — regeneruj ho `npm install`.",
  );
}
// Workspace balík (`"link": true`) se NEstahuje: jeho zdroj je v repu
// (u SDK submodul packages/extranet-sdk, připnutý gitem na konkrétní commit),
// takže verzi i obsah určuje strom, ne registr. Lock pak nese cestu, ne URL.
let zdrojovyAdresar;
if (zaznam.link) {
  if (!zaznam.resolved) padni(`workspace záznam node_modules/${balik} nemá \`resolved\` — chybí cesta ke zdroji`);
  zdrojovyAdresar = zaznam.resolved;
  if (!existsSync(join(zdrojovyAdresar, "package.json"))) {
    padni(
      `workspace ${balik} → ${zdrojovyAdresar}/ ve stromu NENÍ.\n` +
        "  U submodulu: `git submodule update --init` (v Dockerfilu `COPY` té cesty do stage).",
    );
  }
  const verze = JSON.parse(readFileSync(join(zdrojovyAdresar, "package.json"), "utf8")).version;
  zaznam.version = verze;
  process.stderr.write(`[fetch-locked-package] ${balik}@${verze ?? "?"} ← workspace ${zdrojovyAdresar}/\n`);
} else {
  zdrojovyAdresar = await stahniOverenyArchiv(zaznam);
}

/** Stáhne archiv podle `resolved`, ověří `integrity` a vrátí adresář s rozbaleným `package/`. */
async function stahniOverenyArchiv(zaznam) {
  // Tvrdě, ne s výchozí hodnotou: „nevím, odkud" a „nevím, co" nejsou stavy,
  // ze kterých se dá pokračovat.
  if (!zaznam.resolved) padni(`záznam node_modules/${balik} nemá \`resolved\` — není odkud stáhnout`);
  if (!zaznam.integrity) padni(`záznam node_modules/${balik} nemá \`integrity\` — nebylo by co ověřit`);

  const m = String(zaznam.integrity).match(/^(sha\d+)-(.+)$/);
  if (!m) padni(`\`integrity\` má neznámý tvar: ${String(zaznam.integrity).slice(0, 12)}…`);
  const [, algoritmus, ocekavanyOtisk] = m;

  process.stderr.write(`[fetch-locked-package] ${balik}@${zaznam.version ?? "?"} ← ${zaznam.resolved}\n`);

  // Timeout je povinný: registr, který přijme spojení a pak mlčí, by build držel
  // navěky — a zaseknutý build se od pomalého nepozná. Hlídá brána
  // codebase-security-patterns; tady je to navíc věcně správně.
  const hlidac = AbortSignal.timeout(60_000);
  let odpoved;
  try {
    odpoved = await fetch(zaznam.resolved, { signal: hlidac });
  } catch (err) {
    padni(
      err?.name === "TimeoutError"
        ? `registr neodpověděl do 60 s (${new URL(zaznam.resolved).host}) — nedostupný, nebo zaseknutý`
        : `stažení selhalo: ${err?.message ?? err}`,
    );
  }
  if (!odpoved.ok) {
    padni(
      `stažení skončilo HTTP ${odpoved.status}.\n` +
        (odpoved.status === 401 || odpoved.status === 403
          ? "  Registr začal vyžadovat pověření. NEPŘIDÁVEJ token jako build arg —\n" +
            "  zapsal by se do `docker history`. Použij `--mount=type=secret`, jak to\n" +
            "  v témž Dockerfilu dělá `git_token`."
          : "  Registr je nedostupný, nebo ta verze zmizela."),
    );
  }

  const archiv = Buffer.from(await odpoved.arrayBuffer());
  const otisk = createHash(algoritmus).update(archiv).digest("base64");
  if (otisk !== ocekavanyOtisk) {
    padni(
      `otisk staženého archivu NESOUHLASÍ s ${LOCK}.\n` +
        `  čekáno: ${algoritmus}-${ocekavanyOtisk.slice(0, 16)}…\n` +
        `  přišlo: ${algoritmus}-${otisk.slice(0, 16)}…\n` +
        "  Registr vydal jiný obsah pod touž verzí — build se NESMÍ dokončit.",
    );
  }

  mkdirSync(cil, { recursive: true });
  const archivCesta = join(cil, ".stazeny.tgz");
  writeFileSync(archivCesta, archiv);
  // npm archivy mají všechno pod `package/`; rozbalí se celé a vybere se, co je
  // potřeba — `--strip-components` busybox tar neumí spolehlivě.
  execFileSync("tar", ["-xzf", archivCesta, "-C", cil], { stdio: "inherit" });
  rmSync(archivCesta);

  return join(cil, "package");
}

mkdirSync(cil, { recursive: true });
const chybi = [];
for (const soubor of soubory) {
  const zdroj = join(zdrojovyAdresar, soubor);
  if (!existsSync(zdroj)) {
    chybi.push(soubor);
    continue;
  }
  if (!BEZ_EXTERNICH_IMPORTU) {
    copyFileSync(zdroj, join(cil, soubor));
    continue;
  }
  // Řádkově, ne regexem přes celý soubor: `@import url(https://…)` může být
  // dlouhý na tisíce znaků a jediná náhrada přes celý obsah by při chybě
  // v hranici snědla i sousední pravidla.
  const radky = readFileSync(zdroj, "utf8").split("\n");
  const ponechane = radky.filter((r) => !/^\s*@import\s+url\(\s*["']?https?:/i.test(r));
  const odebrano = radky.length - ponechane.length;
  writeFileSync(join(cil, soubor), ponechane.join("\n"));
  if (odebrano > 0) {
    process.stderr.write(
      `[fetch-locked-package] ${soubor}: odebráno ${odebrano} externích @import — ` +
        "přihlašovací stránka nesmí při zobrazení sahat na cizí server\n",
    );
  }
}
if (chybi.length > 0) {
  padni(
    `balík ${balik}@${zaznam.version} tyhle soubory NEOBSAHUJE: ${chybi.join(", ")}.\n` +
      "  Buď se přejmenovaly, nebo se změnil tvar balíku. Zkontroluj `files` v jeho package.json.",
  );
}

process.stderr.write(`[fetch-locked-package] ✓ ${soubory.join(", ")} → ${cil}/\n`);
