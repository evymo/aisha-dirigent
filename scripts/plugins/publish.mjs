#!/usr/bin/env node
/**
 * publish.mjs — doručí zabalený plugin tam, odkud si ho hostitel umí vzít.
 *
 * MÍSTO V DRÁZE
 * -------------
 *   build.mjs        → dist/plugins/<slug>-<verze>.js     (tvar pro sandbox)
 *   → TENHLE KROK    → MinIO + plugin_catalog/plugin_versions
 *   svc-plugin-system  stáhne podle `artifact_url`, ověří `artifact_sha256`
 *
 * Bez něj má registr prázdno a `get_available_plugins` nevrátí nic — plugin
 * existuje ve zdrojích, v testech i v katalogu dokumentace, a přesto ho nelze
 * spustit. Přesně tak to 2026-08-12 vypadalo.
 *
 * DVĚ VĚCI, KTERÉ SE TU NEDAJÍ OBEJÍT
 * -----------------------------------
 * 1. ⛔ `submit_plugin` běží pod `auth.uid()` a vyžaduje `is_admin_or_staff()`.
 *    SERVICE_ROLE klíč tu NESTAČÍ: pod ním je `auth.uid()` NULL a funkce
 *    skončí na „Not authenticated". Je potřeba JWT skutečného admin účtu.
 *    (Není to obtíž, je to záměr — publikace pluginu je čin s autorem.)
 *
 * 2. ⛔ `artifact_url` musí ležet na TÉMŽE hostiteli jako `S3_ENDPOINT`.
 *    Hostitel si stahování pojišťuje SSRF guardem (`sandbox.ts::artifactGuard`),
 *    protože URL přichází z DAT, ne z konfigurace. Adresa složená odjinud
 *    projde publikací a spadne až při prvním spuštění.
 *
 * ŽÁDNÉ FALLBACKY: chybí-li endpoint, klíče, bucket nebo token, skript SKONČÍ.
 * Nedopočítává výchozí hodnoty — tiše publikovat jinam, než si kdo myslí, je
 * horší než nepublikovat.
 *
 * Použití:
 *   DRY_RUN=1 node scripts/plugins/publish.mjs           # ukáž, co by se stalo
 *   node scripts/plugins/publish.mjs                     # všechny zabalené
 *   node scripts/plugins/publish.mjs tcars-fleet         # vybrané
 *
 * Prostředí:
 *   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PLUGIN_BUCKET
 *   AISHA_POSTGREST_URL, AISHA_ADMIN_JWT
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sOpakovanimPriNacitaniSchematu } from "./pgrst-schema-cache.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = process.env.OUT_DIR ?? join(ROOT, "dist", "plugins");
const DRY_RUN = process.env.DRY_RUN === "1";

function musi(jmeno) {
  const v = process.env[jmeno];
  if (!v) {
    console.error(`⛔ chybí ${jmeno} — bez něj nevím, kam publikovat. Nedosazuju výchozí hodnotu.`);
    process.exit(2);
  }
  return v;
}

// ── Vstupy ─────────────────────────────────────────────────────────────────
const vybrane = process.argv.slice(2);

if (!existsSync(DIST) || readdirSync(DIST).filter((f) => f.endsWith(".js")).length === 0) {
  console.log("dist/plugins je prázdný — spouštím build…");
  execFileSync(process.execPath, [join(ROOT, "scripts/plugins/build.mjs")], { cwd: ROOT, stdio: "inherit" });
}

const artefakty = readdirSync(DIST)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const m = /^(.+)-(\d+\.\d+\.\d+)\.js$/.exec(f);
    if (!m) return null;
    return { slug: m[1], verze: m[2], soubor: join(DIST, f) };
  })
  .filter(Boolean)
  .filter((a) => vybrane.length === 0 || vybrane.includes(a.slug));

if (artefakty.length === 0) {
  console.error("⛔ žádný artefakt k publikaci — měřidlo ztratilo předmět.");
  process.exit(2);
}

const S3_ENDPOINT = musi("S3_ENDPOINT");
const BUCKET = musi("S3_PLUGIN_BUCKET");
const PGRST = musi("AISHA_POSTGREST_URL");
const ADMIN_JWT = DRY_RUN ? "" : musi("AISHA_ADMIN_JWT");

const endpoint = new URL(S3_ENDPOINT);

// ── Publikace ──────────────────────────────────────────────────────────────
let chyb = 0;
for (const a of artefakty) {
  const kod = readFileSync(a.soubor, "utf8");
  const sha = createHash("sha256").update(kod).digest("hex");
  const klic = `${a.slug}/${a.verze}.js`;
  // Skládá se z TÉHOŽ endpointu, který uvidí hostitel — jinak to zastaví jeho
  // SSRF guard (viz hlavička).
  const url = `${S3_ENDPOINT.replace(/\/$/, "")}/${BUCKET}/${klic}`;
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", a.slug, "manifest.json"), "utf8"));

  if (manifest.version !== a.verze) {
    console.log(`  ✗ ${a.slug}: artefakt je ${a.verze}, manifest ${manifest.version} — přestav ho`);
    chyb += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`  ∅ ${a.slug.padEnd(22)} → ${url}`);
    console.log(`      sha256=${sha}  kind=${manifest.kind}  ${Buffer.byteLength(kod)} B`);
    continue;
  }

  try {
    const Minio = await import("minio");
    const klient = new Minio.Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
      useSSL: endpoint.protocol === "https:",
      accessKey: musi("S3_ACCESS_KEY"),
      secretKey: musi("S3_SECRET_KEY"),
    });

    if (!(await klient.bucketExists(BUCKET))) await klient.makeBucket(BUCKET);
    // ⏳ DOČASNÝ OBCHVAT — JEN VE FORKU (2026-09-27, souhlas Guru). ODSTRANIT po syncu
    // s upstream #1072 (storage-init: STORAGE_BUCKETS + STORAGE_PUBLIC_READ jako JEDINÝ
    // zakladatel bucketů, brána bucket-ma-sveho-zakladatele) a navazujícím upstream PR
    // „bucket pluginů čte hostitel anonymně“.
    // NAMĚŘENO: svc-plugin-system stahuje artifact_url ANONYMNĚ (sandbox.ts, od ab5412412
    // bez klíčů k MinIO; integritu drží SHA-256 z registru), ale tenhle bucket vznikal bez
    // politiky → 403 → schválený plugin se nikdy nespustil. Jen s3:GetObject na objekty,
    // ŽÁDNÝ ListBucket; MinIO je jen v interní síti instance (žádné ports/labely,
    // storage-auth tenhle bucket veřejně neservíruje).
    await klient.setBucketPolicy(BUCKET, JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${BUCKET}/*`] }],
    }));
    await klient.putObject(BUCKET, klic, Buffer.from(kod, "utf8"), Buffer.byteLength(kod), {
      "Content-Type": "application/javascript",
    });

    // Zpětné čtení: uložení se POTVRZUJE z cíle, ne z návratové hodnoty zápisu.
    // Kdyby se objekt uložil poškozený, hostitel by to poznal až kontrolou
    // SHA-256 za běhu — tedy daleko odsud.
    const zpet = await new Promise((res, rej) => {
      const kusy = [];
      klient
        .getObject(BUCKET, klic)
        .then((s) => s.on("data", (d) => kusy.push(d)).on("end", () => res(Buffer.concat(kusy))).on("error", rej))
        .catch(rej);
    });
    const shaZpet = createHash("sha256").update(zpet).digest("hex");
    if (shaZpet !== sha) {
      console.log(`  ✗ ${a.slug}: uložený objekt má jinou SHA-256 (${shaZpet.slice(0, 12)} ≠ ${sha.slice(0, 12)})`);
      chyb += 1;
      continue;
    }

    // Hranice se MĚŘÍ tak, jak ji projde hostitel: anonymní GET téže adresy, kterou
    // zapíšeme do registru. Bez toho by publikace hlásila ✓ a plugin by za běhu
    // dostal 403 (naměřeno 2026-09-27).
    const anon = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!anon.ok) {
      console.log(`  ✗ ${a.slug}: hostitel artefakt nestáhne — anonymní GET ${url} vrátil ${anon.status}`);
      chyb += 1;
      continue;
    }

    // PGRST002 (schema cache se po migraci ještě načítá) je přechodný — zopakovat.
    const odpoved = await sOpakovanimPriNacitaniSchematu(() =>
      fetch(`${PGRST.replace(/\/$/, "")}/rpc/submit_plugin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_JWT}`,
          apikey: ADMIN_JWT,
        },
        body: JSON.stringify({ p_artifact_sha256: sha, p_artifact_url: url, p_manifest: manifest }),
        // Bez stropu by se skript při nedostupném PostgRESTu zasekl navěky —
        // a zaseknutá publikace vypadá zvenčí jako probíhající, ne jako pád.
        signal: AbortSignal.timeout(30_000),
      }),
    );
    if (!odpoved.ok) {
      const telo = await odpoved.text();
      console.log(`  ✗ ${a.slug}: submit_plugin vrátil ${odpoved.status} — ${telo.slice(0, 200)}`);
      if (/Not authenticated|Unauthorized/.test(telo)) {
        console.log("      ↳ AISHA_ADMIN_JWT musí být token ADMIN ÚČTU; service_role tu nestačí (auth.uid() je pod ním NULL).");
      }
      chyb += 1;
      continue;
    }

    console.log(`  ✓ ${a.slug.padEnd(22)} ${a.verze}  ${sha.slice(0, 12)}  → ${url}`);
  } catch (e) {
    console.log(`  ✗ ${a.slug}: ${e.message}`);
    chyb += 1;
  }
}

console.log(`\n  ${artefakty.length - chyb} publikováno · ${chyb} chyb${DRY_RUN ? "  (DRY_RUN — nic se nezapsalo)" : ""}`);
process.exit(chyb > 0 ? 1 : 0);
