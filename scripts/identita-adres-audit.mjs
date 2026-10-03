#!/usr/bin/env node
/**
 * identita-adres-audit — hledá vnitřní adresy, které nenesou identitu instance.
 *
 * ⛔ TŘÍDA VADY (naměřeno 2026-08-21). Adresa, jejíž host je JMÉNO KONTEJNERU
 * bez prefixu instance, je na sdíleném hostiteli adresa BEZ VLASTNÍKA: patří
 * tomu, kdo na dané síti odpoví první. Nic při tom neselže — spojení se naváže,
 * odpoví cizí služba, a projeví se to o vrstvy dál jako porucha, která
 * s adresou vůbec nesouvisí.
 *
 * Vada bez příznaku je nebezpečnější než výpadek. Proto se hledá i tam, kde
 * „se dnes nic neděje": dnešní bezpečí je jen tím, že to jméno zatím nese
 * jediný kontejner. To není vlastnost návrhu, to je náhoda nasazení.
 *
 * CO SE MĚŘÍ: každá adresa `http(s)://<host>:<port>`, jejíž host nemá tečku
 * (tedy není doména), musí nést `${APP_NAME_PREFIX}`.
 *
 * Co se NEHLÁSÍ a proč:
 *   - `localhost`, `127.0.0.1`, `0.0.0.0`, `host.docker.internal` — smyčka
 *     ani sdílená síť, vlastníka mít nemůžou;
 *   - komentáře — repo o téhle pasti dokumentuje a hlásit vlastní varování
 *     jako nález je šum, který měřidlo znehodnotí;
 *   - testy a lokální stack — jedna instance na stroji, sdílená síť neexistuje.
 *
 * Read-only. Exit 0 = čisto, 1 = nález, 2 = nelze změřit.
 *
 * Usage:
 *   node scripts/identita-adres-audit.mjs
 *   node scripts/identita-adres-audit.mjs --json
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

/** Hosty, které vlastníka mít nemůžou — smyčka nebo runtime hostitele. */
const BEZ_VLASTNIKA = new Set(["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal", "::1"]);

/** Soubory, kde sdílená síť neexistuje, takže holé jméno nikomu nepatří. */
function mimoRozsah(cesta) {
  return (
    /(^|\/)__tests__\//.test(cesta) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(cesta) ||
    /(^|\/)src\/tests\//.test(cesta) ||
    /docker-compose\.local\./.test(cesta) ||
    /\.example($|\.)/.test(cesta) ||
    /(^|\/)docs\//.test(cesta)
  );
}

/** Je řádek komentář? Repo o téhle pasti píše — vlastní varování není nález. */
function jeKomentar(radek) {
  const t = radek.trim();
  return t.startsWith("#") || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function univerzum() {
  const out = execFileSync(
    "git",
    ["ls-files", "--", "docker-compose*.yml", "docker-compose*.yaml", "config", "scripts", "infra", "keycloak"],
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  return out.split("\n").map((s) => s.trim()).filter(Boolean).filter((f) => !mimoRozsah(f));
}

function main() {
  const soubory = univerzum();
  if (soubory.length === 0) {
    console.error("⛔ univerzum je prázdné — měřidlo by tiše zezelenalo nad nulou.");
    process.exit(2);
  }

  const nalezy = [];
  for (const f of soubory) {
    let text;
    try {
      text = readFileSync(resolve(ROOT, f), "utf-8");
    } catch (e) {
      // Tichý přeskok tu nesmí být: „soubor je binární" a „univerzum se
      // rozpadá pod rukama" vypadají v přeskočení stejně, a měřidlo by pak
      // hlásilo klid nad tím, co vůbec nepřečetlo.
      if (e && e.code !== "ENOENT" && !/binary|invalid|EISDIR/i.test(String(e.message))) {
        console.warn(`  ! nepřečteno ${f}: ${e.message}`);
      }
      continue;
    }
    if (!text.includes("://")) continue;
    const radky = text.split("\n");
    for (let i = 0; i < radky.length; i += 1) {
      const radek = radky[i];
      if (jeKomentar(radek)) continue;
      // ⛔ PRÓZA NENÍ ADRESA. Katalog popisuje služby v polích `_comment`
      // a ta próza adresy CITUJE („svc-blockchain, Node/Fastify port 3013").
      // Hlásit citaci jako vadu je šum, který měřidlo znehodnotí.
      if (/"_[a-z_]*(comment|note|notes|doc)"\s*:/i.test(radek)) continue;
      // ⛔ HLÁŠKA PRO OPERÁTORA TAKÉ NENÍ ADRESA. Skripty adresy CITUJÍ
      // v nápovědě („e.g. http://gateway:3001") a v `echo`, kde radí, kudy se
      // ke službě dostat. Hlásit nápovědu jako vadu je týž šum jako hlásit
      // komentář — a měřidlo, kterému se přestane věřit, je k ničemu.
      if (/\be\.g\.|\bnapř\./i.test(radek)) continue;
      if (/^\s*(echo|printf)\b/.test(radek.trim())) continue;
      for (const m of radek.matchAll(/https?:\/\/([A-Za-z0-9_${}.-]+):(\d+)/g)) {
        const host = m[1];
        if (host.includes(".")) continue;          // doména, ne kontejner
        if (BEZ_VLASTNIKA.has(host)) continue;
        // ⛔ IDENTITU NENESE JEN `APP_NAME_PREFIX`. Repo ji podle vrstvy nazývá
        // taky `prefix`, `INSTANCE_PREFIX`, `deployPrefix`… Kdyby měřidlo znalo
        // jediné jméno, hlásilo by jako nález i adresy, které jsou v pořádku —
        // a falešný nález posílá člověka opravovat něco zdravého.
        // ⛔ IDENTITU NENESE JEN PROMĚNNÁ JMÉNEM `*PREFIX*`. Repo ji podle
        // vrstvy nazývá `prefix`, `INSTANCE_PREFIX`, `IDENTITY`, `deployPrefix`…
        // Rozhoduje POZICE, ne jméno: začíná-li host proměnnou, je prefixová
        // pozice obsazená a o správnosti hodnoty rozhoduje ta proměnná, ne my.
        // (Kdyby měřidlo znalo jediné jméno, hlásilo by jako nález i adresy,
        // které jsou v pořádku — a falešný nález posílá člověka opravovat
        // něco zdravého.)
        if (/^\$\{/.test(host)) continue;
        nalezy.push({ soubor: f, radek: i + 1, host, adresa: m[0] });
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ nalezu: nalezy.length, souboru: soubory.length, nalezy }, null, 2));
  } else {
    console.log(`\nidentita-adres-audit — prohlédnuto ${soubory.length} souborů, nálezů: ${nalezy.length}\n`);
    const podleHosta = new Map();
    for (const n of nalezy) {
      if (!podleHosta.has(n.host)) podleHosta.set(n.host, []);
      podleHosta.get(n.host).push(n);
    }
    for (const [host, vyskyty] of [...podleHosta].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`✗ ${host}  (${vyskyty.length}×)`);
      for (const v of vyskyty.slice(0, 6)) console.log(`    ${v.soubor}:${v.radek}  ${v.adresa}`);
      if (vyskyty.length > 6) console.log(`    … a dalších ${vyskyty.length - 6}`);
    }
    if (nalezy.length) {
      console.log(
        "\nCO S TÍM: napiš adresu jako `http://${APP_NAME_PREFIX}-<služba>:<port>`.\n" +
          "  V compose je identita povinná (`${APP_NAME_PREFIX:?identita instance}`), takže\n" +
          "  chybějící prefix zastaví render místo aby trefil cizí instanci.\n" +
          "\nNEDĚLEJ: nedosazuj jméno konkrétní instance. Katalog i stack jsou instančně\n" +
          "  neutrální a fork se do upstreamu vrací JEDNÍM merge — jméno by se rozšířilo všude.\n",
      );
    } else {
      console.log("· žádná vnitřní adresa nepostrádá identitu instance.\n");
    }
  }
  process.exit(nalezy.length > 0 ? 1 : 0);
}

main();
