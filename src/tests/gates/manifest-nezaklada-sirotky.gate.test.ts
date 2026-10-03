/**
 * Brána: co manifest ZALOŽÍ, musí nějaká vlna NASADIT.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * Seznam zakládaných aplikací vzniká SKENOVÁNÍM `docker-compose.coolify-*.yml`
 * na disku (`gen-instance-manifest.mjs`), kdežto seznam nasazovaných je psaný
 * ve vlnách (`aisha-redeploy.mjs`). Dvě různá univerza pro tutéž otázku „co je
 * platforma" se z principu nemůžou shodnout.
 *
 * ⛔ NAMĚŘENO 2026-08-26 po wipu: 34 aplikací založeno, 33 jmenováno ve vlnách,
 * PRÁVĚ JEDEN sirotek — `<prefix>-shared`. V Coolify po něm zůstal prázdný
 * záznam (nula kontejnerů, `exited:unhealthy`), který kazil KAŽDÉ měření „je
 * stack zdravý" a nešel odlišit od skutečně spadlé aplikace.
 *
 * Ten konkrétní stack byl přežitek — MinIO se přestěhoval do jádra a ke
 * jmenovaným účtům, které zakládal, se nikdo nehlásil. Vada ale není v něm:
 * je v tom, že takový rozpor nikdo neměřil.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * Co manifest ZALOŽÍ — reprodukce pravidla z `gen-instance-manifest.mjs`.
 *
 * ⛔ Jméno aplikace NENÍ jméno compose. Několik aplikací sdílí jeden compose
 * a několik se jmenuje jinak (`orchestration` ← coolify-n8n, `messaging` ←
 * coolify-matrix, `ledger` ← coolify-cosmos). První verze téhle brány je
 * ztotožnila a nahlásila ŠEST falešných sirotků. Univerzum se proto skládá
 * stejně jako v generátoru: kurátorované mapování ze sourozeneckých manifestů,
 * a teprve zbylé compose se přidají pod svým vlastním jménem.
 */
function zalozeneAplikace(): { jmeno: string; compose: string }[] {
  const manifestDir = join(ROOT, "coolify/manifests");
  const declared = new Map<string, string>(); // jméno → compose
  for (const f of readdirSync(manifestDir).filter((f) => f.endsWith(".manifest"))) {
    for (const line of readFileSync(join(manifestDir, f), "utf-8").split(/\r?\n/)) {
      const m = /^app:\s*([a-z0-9-]+):([a-z]+):(\S+)/.exec(line.trim());
      if (m && !declared.has(m[1]) && existsSync(join(ROOT, m[3]))) declared.set(m[1], m[3]);
    }
  }
  const apps = [...declared.entries()].map(([jmeno, compose]) => ({ jmeno, compose }));
  const pokryto = new Set(apps.map((a) => a.compose));
  for (const f of readdirSync(ROOT).filter((f) => /^docker-compose\.coolify-[a-z0-9-]+\.yml$/.test(f))) {
    if (pokryto.has(f)) continue;
    const jmeno = /^docker-compose\.coolify-([a-z0-9-]+)\.yml$/.exec(f)![1];
    if (declared.has(jmeno)) continue;
    apps.push({ jmeno, compose: f });
  }
  return apps;
}

/** Co vlny nasazují: jména z bloku WAVES v aisha-redeploy.mjs. */
function waveIds(): Set<string> {
  const rd = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf-8");
  const zac = rd.indexOf("const WAVES");
  const kon = rd.indexOf("const SOFT_DEPLOY_APPS");
  expect(zac, "blok WAVES se nenašel — brána by měřila prázdno").toBeGreaterThan(0);
  expect(kon, "konec bloku WAVES se nenašel").toBeGreaterThan(zac);
  return new Set([...rd.slice(zac, kon).matchAll(/"aisha-([a-z0-9-]+)"/g)].map((m) => m[1]));
}

describe("manifest nezakládá aplikace, které nikdo nenasazuje", () => {
  test("univerza nejsou prázdná — jinak by brána mlčela místo měření", () => {
    expect(zalozeneAplikace().length).toBeGreaterThan(20);
    expect(waveIds().size).toBeGreaterThan(20);
  });

  test("KAŽDÝ compose, který manifest založí, je jmenován nějakou vlnou", () => {
    const vlny = waveIds();
    const sirotci = zalozeneAplikace().map((a) => a.jmeno).filter((j) => !vlny.has(j));
    expect(
      sirotci,
      "compose na disku → manifest z něj UDĚLÁ aplikaci v Coolify, ale žádná vlna ji\n" +
        "nenasadí. Zůstane prázdný záznam, který kazí každé měření zdraví stacku\n" +
        "a nejde odlišit od skutečně spadlé aplikace.\n" +
        "Buď stack do vlny patří, nebo jeho compose nepatří na tohle místo.",
    ).toEqual([]);
  });
});
