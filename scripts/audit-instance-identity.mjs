#!/usr/bin/env node
/**
 * audit-instance-identity — hledá IDENTITU INSTANCE VEPSANOU NATVRDO.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-25). `coolify/netbird-management.json.template`
 * měla realm natvrdo `aisha` na OSMI místech a `${KEYCLOAK_REALM}` nepoužívala
 * vůbec. Management pak čekal vydavatele `.../realms/aisha`, kdežto token nesl
 * `.../realms/<instance>-realm` — NESHODA VYDAVATELE, tedy `no valid
 * authentication provided` na KAŽDÝ token. Řetěz následků: žádný účet → žádný
 * setup key → žádní peers → mesh nevznikla → api 502, extranet 404.
 *
 * Hláška mluvila o tokenu, příčinou byla identita instance ve sdílené šabloně.
 * Ruční grep to najde jednou; tenhle skript to najde pokaždé.
 *
 * Proč vlastní průchod a ne `grep`: obal nad grepem v tomhle prostředí ctí
 * `.gitignore`, takže by audit TIŠE přeskočil právě ty soubory, ve kterých
 * nasazené hodnoty bydlí (.env.coolify a spol.). Slepá skvrna v měřidle je
 * horší než chybějící měřidlo — tvrdí, že je čisto.
 *
 * Výjimka je opt-in a jednořádková: `identita: dolozeny incident`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Kořen lze zadat argumentem — jinak repozitář, ve kterém skript leží.
// Argument je tu kvůli SEBETESTU brány: měřidlo se musí dát pustit na dočasný
// strom se známou vadou, jinak nelze ověřit, že vůbec něco vidí.
const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : join(fileURLToPath(new URL(".", import.meta.url)), "..");

const PRESKOCIT_ADRESARE = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo",
  "docs", "obsolete", ".venv", "vendor", "__pycache__",
  // Archiv není konfigurace — nic z něj se nenasazuje.
  "trash", "legacy-archive",
]);
// ⛔ Testovací soubory se neskenují: literál v nich je DATA (fixtura), ne
// konfigurace nasazení. Test, který ověřuje odmítnutí cizího vydavatele, ten
// cizí realm MUSÍ napsat doslova — jinak nemá co ověřovat.
const TESTOVACI = /\.(test|spec)\.[mc]?[jt]s$|(^|\/)__tests__(\/|$)/;
// Prózu neskenujeme — dokumentace incident POPISUJE, nezpůsobuje ho.
const PRIPONY = new Set([".yml", ".yaml", ".template", ".mjs", ".js", ".ts", ".sh", ".json"]);
const JMENA_NAVIC = /^\.env(\.|$)|^domains\.env|\.env\.example$/;
// ⛔ VYRENDEROVANÉ VÝSLEDKY se neskenují. `.env.coolify` a jeho zálohy jsou to,
// co ze zdrojů VZNIKLO — literál je tam SPRÁVNĚ, je to smysl dosazení. Pravidlo
// zní „v souboru, jehož mechanismem je dosazování ${VAR}, musí být identita
// proměnná" — a rendrovaný soubor už žádný mechanismus nemá. Kdyby se skenovaly,
// měřidlo by hlásilo 300+ falešných nálezů a tím pohřbilo ty skutečné.
const VYRENDEROVANE = /^\.env\.coolify|^\.env-prod-backup|^\.env\.local|\.bak[-.]|\.bak$|\.generated\./;

/** Řádek, který je celý komentář, nic nekonfiguruje. */
function jeKomentar(radek) {
  const t = radek.trim();
  return t.startsWith("#") || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Je ten realm NÁŠ, nebo cizího poskytovatele identity?
 *
 * ⛔ `https://login.eurowag.com/auth/realms/eurowag` je realm DODAVATELE na jeho
 * vlastním Keycloaku — konstanta z cizí smlouvy, kterou nemáme čím dosadit
 * a měnit ji nesmíme. Kdyby ji měřidlo hlásilo, nutilo by nás „opravit" cizí
 * identitu naší proměnnou, tedy rozbít integraci.
 *
 * Za náš se počítá hostitel, který je dosazovaný (`${...}`), jmenuje se
 * keycloak, začíná `auth.`, nebo je lokální.
 */
function nasKeycloak(radek, poziceRealmu) {
  // ⛔ Bere se CELÁ URL před realmem, ne poslední úsek cesty. První verze
  // četla jen poslední token, takže `${KC}/admin/realms/aisha` viděla jako
  // hostitele „admin" → cizí → přeskočeno. Slepé místo přesně na admin API
  // Keycloaku: sebetest chytil 7 z 8 výskytů té vady, co shodila fázi D.
  const pred = radek.slice(0, poziceRealmu);
  const url = pred.match(/(?:https?:)?\/\/[^\s"'`,]*$|\$\{[^}]+\}[^\s"'`,]*$/i)?.[0] ?? pred;
  return (
    url.includes("${") ||
    /keycloak/i.test(url) ||
    /(^|[/@.])auth[.:]/i.test(url) ||
    /localhost|127\.0\.0\.1/.test(url)
  );
}

const PRAVIDLA = [
  {
    id: "realm-natvrdo",
    // Realm je identita instance. Za `/realms/` smí stát jen dosazovaná hodnota.
    re: /\/realms\/(?!\$\{|%7B|\{\{|<)([A-Za-z0-9_-]+)/g,
    popis: (m) => `realm '${m[1]}' je vepsaný natvrdo — patří sem ${"${KEYCLOAK_REALM}"}`,
    // `master` je VESTAVĚNÝ administrátorský realm Keycloaku — skutečná konstanta
    // produktu, ne identita instance. Existuje v každé instalaci pod týmž jménem.
    // Lokální vývoj má navíc vlastní DEKLAROVANÝ domov (LOCAL_KC_REALM), a to je
    // odvození, ne opsaný literál.
    ok: (radek, m) =>
      m[1] === "master" ||
      radek.includes("LOCAL_KC_REALM") ||
      radek.includes("KEYCLOAK_REALM") ||
      !nasKeycloak(radek, m.index),
  },
  {
    id: "prefix-natvrdo",
    // Jméno na SDÍLENÉM HOSTITELI musí nést identitu instance, ne konstantu 'aisha'.
    //
    // ⛔ Pravidlo je ÚZKÉ ZÁMĚRNĚ. První verze hlásila i `scripts/aisha-deps-update.mjs`
    // a `group: aisha-packages-publish` — jenže to jsou jména SOUBORŮ a CI úloh
    // v upstreamu, ne jména běžících věcí. Měřidlo, které hlásí 300 nálezů,
    // z nichž 290 je šum, se přestane číst — a tím přestane chránit.
    //
    // Hlídají se proto jen tři pozice, kde jméno opravdu bydlí:
    //   container_name: aisha-x   hostname: aisha-x   http://aisha-x:port
    re: /(?:container_name:\s*|hostname:\s*|:\/\/)aisha-(?!guru|platform|dirigent|realm)([a-z0-9]+(?:-[a-z0-9]+)*)/g,
    popis: (m) => `'aisha-${m[1]}' je konstanta v místě běhového jména — patří sem ${"${APP_NAME_PREFIX}"}-${m[1]}`,
    // ⛔ `http://aisha-kronos-shim:9625` NENÍ vada, když `aisha-kronos-shim` je
    // KLÍČ SLUŽBY v témže souboru — docker DNS ho rozliší a jméno je file-local,
    // takže mezi tenanty nekoliduje. Kolidovat může jen `container_name`, které
    // se zapisuje na sdíleného démona. Naměřeno při prvním běhu tohohle skriptu:
    // bez téhle výjimky by „oprava" rozpojila funkční odkaz.
    ok: (radek, _m, klice) => radek.includes("APP_NAME_PREFIX") || klice.has(`aisha-${_m[1]}`),
    jen: (rel) => /\.(yml|yaml|template)$/.test(rel) && !rel.startsWith(".forgejo/") && !rel.startsWith(".github/"),
  },
];

const nalezy = [];
// ⛔ Nečitelné cesty se SBÍRAJÍ, ne polykají. Audit, který tiše přeskočí soubor,
// na který nedosáhl, a pak ohlásí „čisto", lže — a je to táž slepá skvrna, před
// kterou tenhle skript varuje o pár řádků výš. Zachytila to brána
// `silent-degradation`, když tady stálo `catch { continue; }`.
const neprectene = [];
// Vnořené repozitáře, které průchod vynechal — hlásí se, aby přeskok nebyl tichý.
const submoduly = [];

/**
 * Vnořené repozitáře (submoduly) se NESKENUJÍ — jejich obsah žije v JINÉM repu
 * a tímhle měřidlem se neopravuje.
 *
 * ⛔ NAMĚŘENO 2026-09-05. `packages/local-ingest/docker-compose.local.yml:33`
 * nese `container_name: aisha-local-ingest-local`. V hlavní kopii submodul
 * NENÍ vytažený (`git submodule status` = `-0951dbe…`), takže ho průchod
 * nikdy neuvidí a brána je zelená. V čerstvém `git worktree` se submoduly
 * vytáhnou — a táž brána na témže commitu spadne. Verdikt tedy nezávisel na
 * kódu, ale na tom, jestli je cizí repo náhodou na disku.
 *
 * Hranice je přitom v tomhle repu už zavedená: `verify-no-dev-generated
 * -codes` přeskakuje gitlinky (mode 160000) s poznámkou „obsah žije v JINÉM
 * repu". Dvě měřidla téhož repa měla dvě různé hranice; tohle je srovnává.
 *
 * Detekce je souborová (`<dir>/.git` existuje), ne přes `git` — audit musí jít
 * pustit i na dočasný strom bez gitu (sebetest brány to dělá).
 */
function jeVnorenyRepozitar(cesta) {
  return existsSync(join(cesta, ".git"));
}

function projdi(dir) {
  let polozky;
  try {
    polozky = readdirSync(dir);
  } catch (e) {
    neprectene.push({ cesta: relative(ROOT, dir), duvod: `adresář nelze číst: ${e.code ?? e.message}` });
    return;
  }
  for (const polozka of polozky) {
    if (PRESKOCIT_ADRESARE.has(polozka)) continue;
    const cesta = join(dir, polozka);
    let st;
    try {
      st = statSync(cesta);
    } catch (e) {
      neprectene.push({ cesta: relative(ROOT, cesta), duvod: `stat selhal: ${e.code ?? e.message}` });
      continue;
    }
    if (st.isDirectory()) {
      if (jeVnorenyRepozitar(cesta)) { submoduly.push(relative(ROOT, cesta)); continue; }
      projdi(cesta);
      continue;
    }

    const rel = relative(ROOT, cesta);
    const jmeno = basename(cesta);
    if (VYRENDEROVANE.test(jmeno)) continue;
    if (!PRIPONY.has(extname(cesta)) && !JMENA_NAVIC.test(jmeno)) continue;
    if (rel.startsWith("src/tests/gates/")) continue; // brány drží záporné vzory ZÁMĚRNĚ
    if (TESTOVACI.test(rel)) continue;

    let text;
    try {
      text = readFileSync(cesta, "utf8");
    } catch (e) {
      neprectene.push({ cesta: rel, duvod: `soubor nelze číst: ${e.code ?? e.message}` });
      continue;
    }
    if (text.indexOf("\0") !== -1) continue; // binárka

    // Klíče služeb (`^  <jmeno>:`) jsou jména platná jen uvnitř souboru.
    const kliceSluzeb = new Set(
      [...text.matchAll(/^ {2}([a-z][\w.-]*):\s*$/gm)].map((m) => m[1]),
    );

    text.split("\n").forEach((radek, i) => {
      if (jeKomentar(radek)) return;
      if (/identita:\s*dolozen/i.test(radek)) return; // opt-in výjimka
      for (const p of PRAVIDLA) {
        if (p.jen && !p.jen(rel)) continue;
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(radek)) !== null) {
          if (p.ok?.(radek, m, kliceSluzeb)) continue;
          nalezy.push({
            soubor: rel,
            radek: i + 1,
            pravidlo: p.id,
            popis: p.popis(m),
            ukazka: radek.trim().slice(0, 110),
          });
        }
      }
    });
  }
}

projdi(ROOT);

if (neprectene.length > 0) {
  console.error(`⚠️  ${neprectene.length} cest(a) se nedala přečíst — audit je o ně NEÚPLNÝ:`);
  for (const n of neprectene) console.error(`     ${n.cesta} — ${n.duvod}`);
  console.error("");
}

if (nalezy.length === 0) {
  const vyhrada = neprectene.length > 0 ? ` (ale ${neprectene.length} cest nepřečteno — viz výše)` : "";
  const preskoceno = submoduly.length > 0
    ? ` — přeskočeno ${submoduly.length} vnořen(ý/é) repozitář(e): ${submoduly.join(", ")}`
    : "";
  console.log(`✅ identita instance: nikde vepsaná natvrdo (realm ani prefix jména)${vyhrada}${preskoceno}`);
  process.exit(0);
}

if (submoduly.length > 0) {
  console.error(`ℹ️  přeskočeno ${submoduly.length} vnořen(ý/é) repozitář(e) — obsah žije v jiném repu: ${submoduly.join(", ")}\n`);
}
console.error(`❌ identita instance vepsaná natvrdo — ${nalezy.length} nález(ů):\n`);
for (const n of nalezy) {
  console.error(`  ${n.soubor}:${n.radek}  [${n.pravidlo}]`);
  console.error(`      ${n.popis}`);
  console.error(`      ${n.ukazka}`);
}
console.error(`\n  Oprav dosazením proměnné. Doložený incident, který MUSÍ zůstat`);
console.error(`  doslova, označ na jeho řádku: \`identita: dolozeny incident\`.`);
process.exit(1);
