#!/usr/bin/env node
/**
 * zarizeni-nahraj-balicek.mjs — nahraje balíček do úložiště instance.
 *
 * ⭐ PROČ EXISTUJE. Binárka je ARTEFAKT (rozhodnutí majitele 2026-09-22): do
 * repa nepatří, do obrazu taky ne — bydlí v úložišti. Cesta dovnitř vede za
 * dveřmi, kam CI nevidí, takže ji otevírá člověk. Tenhle skript z toho dělá
 * OPAKOVATELNÝ krok místo kliknutí, které si nikdo nezapíše.
 *
 * ⛔ TOKEN SE NEVYRÁBÍ, DODÁVÁ SE. Skript si NIKDY nebere heslo a nepřihlašuje
 * se: dostane hotový `access_token` v souboru nebo v proměnné. Kdo skript pustí,
 * rozhoduje, čí identitou se nahrává — a heslo mu nikam neputuje.
 *
 * ⛔ OTISK SE OVĚŘÍ DOMA, PŘED ODESLÁNÍM. Server nahrání s jiným otiskem odmítne
 * (409), ale u 86MB balíčku je to 86 MB po drátě pro jistou chybu. Kontrakt
 * hranice se měří PŘED odesláním.
 *
 * Použití:
 *   AISHA_ADMIN_TOKEN_FILE=~/.aisha-work/trezor/admin-token.txt \
 *   node scripts/zarizeni-nahraj-balicek.mjs \
 *     --api https://api.<vase-instance>/storage/v1 \
 *     --deklarace <cesta>/zarizeni/hlidac.json \
 *     --hlidac  ~/.aisha-work/artefakty/zarizeni/hlidac.apk \
 *     --appka cz.riq.ridic=~/.aisha-work/artefakty/zarizeni/ridic.apk
 *
 * Exit: 0 = vše nahráno (nebo už drželo), 1 = cokoli nesedlo.
 */
import { readFileSync, statSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { isDirectRun } from "./lib/cli-entry.mjs";

const APK_TYP = "application/vnd.android.package-archive";
/** 15 minut — unese desítky MB na pomalé lince, a přesto se jednou vzdá. */
const TIMEOUT_MS = 900_000;

export function otiskSouboru(cesta) {
  return createHash("sha256").update(readFileSync(cesta)).digest("hex");
}

/** Co se má nahrát: `[{ klic, url, soubor, ocekavanySha256 }]`. */
export function plan(deklarace, api, { hlidac, appky }) {
  const out = [];
  if (hlidac) {
    const sha = deklarace?.apk?.sha256;
    if (!sha) throw new Error("deklarace neuvádí apk.sha256 — bez otisku se nenahrává");
    out.push({ co: "hlídač", url: `${api}/zarizeni/hlidac`, soubor: hlidac, ocekavanySha256: String(sha).toLowerCase() });
  }
  for (const [balicek, soubor] of Object.entries(appky ?? {})) {
    const a = (deklarace?.appky ?? []).find((x) => x.balicek === balicek);
    if (!a) throw new Error(`appka ${balicek} není v deklaraci — nahrává se jen deklarované`);
    out.push({
      co: balicek,
      url: `${api}/zarizeni/appky/${encodeURIComponent(balicek)}`,
      soubor,
      ocekavanySha256: String(a.sha256).toLowerCase(),
    });
  }
  if (out.length === 0) throw new Error("nic k nahrání — zadej --hlidac nebo --appka <balicek>=<soubor>");
  return out;
}

function argumenty(argv) {
  const a = { appky: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--api") a.api = argv[++i];
    else if (k === "--deklarace") a.deklarace = argv[++i];
    else if (k === "--hlidac") a.hlidac = argv[++i];
    else if (k === "--appka") {
      const p = argv[++i] ?? "";
      const j = p.indexOf("=");
      if (j < 1) throw new Error(`--appka čeká <balicek>=<soubor>, dostal "${p}"`);
      a.appky[p.slice(0, j)] = p.slice(j + 1);
    } else throw new Error(`neznámý přepínač ${k}`);
  }
  return a;
}

function token() {
  const primo = process.env.AISHA_ADMIN_TOKEN;
  if (primo && primo.trim()) return primo.trim();
  const soubor = process.env.AISHA_ADMIN_TOKEN_FILE;
  if (!soubor) {
    throw new Error(
      "chybí AISHA_ADMIN_TOKEN_FILE (nebo AISHA_ADMIN_TOKEN).\n" +
        "Token si skript NEVYRÁBÍ: přihlas se do administrace a ulož `access_token` do souboru.",
    );
  }
  // ⛔ ŽÁDNÝ DOSAZENÝ LITERÁL. `~` bez HOME by ukázal na adresář jménem "~"
  //    v pracovním adresáři — soubor by "nebyl" a hledalo by se to v tokenu.
  const domov = process.env.HOME;
  if (soubor.startsWith("~") && !domov) throw new Error("cesta začíná ~, ale HOME není nastavené — zadej úplnou cestu");
  const t = readFileSync(domov ? soubor.replace(/^~/, domov) : soubor, "utf8").trim();
  if (!t) throw new Error(`${soubor} je prázdný`);
  return t;
}

async function main() {
  const a = argumenty(process.argv.slice(2));
  if (!a.api || !a.deklarace) throw new Error("chybí --api nebo --deklarace");
  const deklarace = JSON.parse(readFileSync(a.deklarace, "utf8"));
  const ukoly = plan(deklarace, a.api.replace(/\/$/, ""), a);
  const t = token();

  let chyb = 0;
  for (const u of ukoly) {
    const skutecny = otiskSouboru(u.soubor);
    if (skutecny !== u.ocekavanySha256) {
      // ⛔ Doma a hlasitě: 86 MB po drátě pro jistou 409 nikomu nepomůže.
      console.error(`⛔ ${u.co}: otisk souboru NESEDÍ na deklaraci`);
      console.error(`   deklarace: ${u.ocekavanySha256}`);
      console.error(`   soubor:    ${skutecny}`);
      chyb++;
      continue;
    }
    const bajtu = statSync(u.soubor).size;
    process.stdout.write(`▶ ${u.co}: ${(bajtu / 1048576).toFixed(1)} MB → ${u.url}\n`);
    const res = await fetch(u.url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": APK_TYP, "Content-Length": String(bajtu) },
      body: createReadStream(u.soubor),
      duplex: "half",
      // ⛔ Strop času musí unést DESÍTKY MB na pomalé lince: appka řidiče má
      //    86 MB. Bez stropu ale nahrávání visí donekonečna a nikdo se nedozví,
      //    jestli běží, nebo je mrtvé.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const telo = await res.text();
    if (!res.ok) {
      console.error(`⛔ ${u.co}: HTTP ${res.status} ${telo.slice(0, 200)}`);
      chyb++;
      continue;
    }
    console.log(`✅ ${u.co}: ${telo.slice(0, 160)}`);
  }
  if (chyb > 0) {
    console.error(`\n⛔ ${chyb} z ${ukoly.length} balíčků se nenahrálo.`);
    process.exit(1);
  }
  console.log(`\n✅ hotovo — ${ukoly.length} balíček(ů) v úložišti.`);
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    console.error(`⛔ ${e.message}`);
    process.exit(1);
  });
}
