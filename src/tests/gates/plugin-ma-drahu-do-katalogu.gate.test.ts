/**
 * Plugin musí mít DRÁHU DO KATALOGU (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-02 V PROVOZU. `plugin_catalog` měl NULA řádků, přestože
 * v repu leží čtyři pluginy s platným manifestem a `kind: data_source`:
 *
 *     plugins/{eurowag-telematics,tcars-fleet,webdispecink-fleet,partner-metrics}
 *     plugin_catalog        0 řádků
 *     plugin_versions       0
 *     plugin_schedules      0
 *     source_plugin_id      NULL u VŠECH zdrojů
 *     wd_* / tc_*           0 řádků
 *
 * Příčina byla v PRVNÍM článku: `plugins:build` ani `plugins:publish` NEMĚLY
 * VOLAJÍCÍHO. `dist/plugins/` vůbec neexistovalo. Všechno za tím byla jen
 * deklarace — `webdispecink-fleet` byl `is_active = true` tři dny a přivezl
 * nula řádků, protože neměl vykonavatele.
 *
 * ⭐ TŘÍDA VADY: NÁSTROJ BEZ VOLAJÍCÍHO. `publish.mjs` vznikl 2026-08-12 právě
 * kvůli tomuhle stavu — v jeho hlavičce stojí „Bez něj má registr prázdno …
 * Přesně tak to 2026-08-12 vypadalo." Napsal se nástroj, nezavedlo se volání,
 * a vada se vrátila. Brána proto nehlídá existenci nástroje, ale SPOUŠTĚČ.
 *
 * ⛔ A PROČ TO NEZACHYTILY EXISTUJÍCÍ BRÁNY: `plugin-dorazi-do-sandboxu`
 * i `plugin-kind-has-materializer` čtou manifesty `readFileSync`. Kód je
 * v pořádku a ony to správně dokládají — jen se neptají, jestli se někam dostal.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * Pluginy se HLEDAJÍ, nevypisují — ručně psaný seznam mine ten příští.
 *
 * ⛔ NEČITELNÝ MANIFEST JE NÁLEZ, NE VÝCHOZÍ HODNOTA. První verze měla
 * `catch { out.push({ slug: d.name, kind: "" }) }` — rozbitý manifest by se tím
 * tiše proměnil v plugin bez druhu a kontrola `data_source` by ho PŘESKOČILA.
 * Vada by se schovala uvnitř měřidla, které ji má hlásit. Brána
 * `silent-degradation` to právem odmítla.
 */
function pluginy(): { slug: string; kind: string; vada?: string }[] {
  const dir = join(ROOT, "plugins");
  if (!existsSync(dir)) return [];
  const out: { slug: string; kind: string; vada?: string }[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const m = join(dir, d.name, "manifest.json");
    if (!existsSync(m)) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(readFileSync(m, "utf8")) as Record<string, unknown>;
    } catch (e) {
      out.push({ slug: d.name, kind: "", vada: `manifest nejde přečíst: ${String(e).slice(0, 80)}` });
      continue;
    }
    const slug = typeof j.slug === "string" ? j.slug : d.name;
    const kind = typeof j.kind === "string" ? j.kind : "";
    out.push(kind ? { slug, kind } : { slug, kind, vada: "manifest nedeklaruje `kind`" });
  }
  return out;
}

/**
 * Komentáře nejsou kód.
 *
 * ⛔ NAMĚŘENO PŘI PSANÍ TÉHLE BRÁNY: první verze hledala v celém textu a našla
 * VLASTNÍ komentář v compose („`plugins:build` ani `plugins:publish`…"). Obě
 * mutace tím prošly zeleně — brána nemohla selhat, a to je horší než žádná:
 * tvářila by se jako ochrana. Měří se proto jen řádky, které něco DĚLAJÍ.
 */
function bezKomentaru(t: string): string {
  return t
    .split("\n")
    .filter((r) => !/^\s*(#|\/\/|\*|\/\*)/.test(r))
    .join("\n");
}

/** Kdo v repu spouští publikaci — hledá se přes compose i skripty. */
function spousteciPublikace(): string[] {
  const nalez: string[] = [];
  for (const f of readdirSync(ROOT)) {
    if (!/^docker-compose.*\.ya?ml$|^Dockerfile\./.test(f)) continue;
    const t = bezKomentaru(readFileSync(join(ROOT, f), "utf8"));
    if (/publish-plugins\.sh|plugins\/publish\.mjs|plugins:publish/.test(t)) nalez.push(f);
  }
  for (const d of ["scripts", "infra/plugins"]) {
    const p = join(ROOT, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) {
      if (!/\.(sh|mjs)$/.test(f)) continue;
      const rel = `${d}/${f}`;
      if (rel === "scripts/plugins/publish.mjs") continue; // sám sebe nespouští
      const t = bezKomentaru(readFileSync(join(ROOT, rel), "utf8"));
      if (/plugins\/publish\.mjs|plugins:publish/.test(t)) nalez.push(rel);
    }
  }
  return [...new Set(nalez)];
}

describe("plugin má dráhu do katalogu", () => {
  test("univerzum není prázdné — jinak brána nic neměří", () => {
    expect(pluginy().length).toBeGreaterThan(0);
  });

  test("každý manifest je čitelný a deklaruje `kind`", () => {
    const vadne = pluginy().filter((p) => p.vada).map((p) => `${p.slug}: ${p.vada}`);
    expect(
      vadne,
      "Plugin, jehož manifest nejde přečíst, by v dalších testech tiše propadl\n" +
        "jako plugin bez druhu — a kontrola dráhy do katalogu by ho přeskočila.",
    ).toEqual([]);
  });

  test("⛔ publikace MÁ SPOUŠTĚČE — nástroj bez volajícího je vada, ne nástroj", () => {
    const s = spousteciPublikace();
    expect(
      s,
      "Nikdo `plugins:publish` nespouští. Katalog zůstane prázdný, zdroje budou\n" +
        "`is_active` bez vykonavatele a data nepřitečou — přesně stav z 2026-08-12\n" +
        "i 2026-09-02. Spouštěč patří do nasazení, ne do runbooku.",
    ).not.toEqual([]);
  });

  test("krok publikace se z compose skutečně volá", () => {
    const zCompose = spousteciPublikace().filter((f) => /^docker-compose/.test(f));
    expect(
      zCompose,
      "Spouštěč mimo nasazovací dráhu (jen skript, který se pouští ručně) je\n" +
        "runbook, ne automatika — a runbook nikdo nespustí.",
    ).not.toEqual([]);
  });

  test("každý data_source plugin je zabalitelný — má adapter_entry", () => {
    const bez: string[] = [];
    for (const p of pluginy()) {
      if (p.kind !== "data_source") continue;
      const m = JSON.parse(readFileSync(join(ROOT, "plugins", p.slug, "manifest.json"), "utf8"));
      const specy = Object.entries(m).filter(([k]) => k.endsWith("_spec"));
      if (!specy.some(([, v]) => v && typeof v === "object" && "adapter_entry" in (v as object))) {
        bez.push(p.slug);
      }
    }
    expect(
      bez,
      "data_source bez `adapter_entry` build PŘESKOČÍ — plugin projde testy,\n" +
        "ale artefakt nevznikne a do katalogu se nikdy nedostane.",
    ).toEqual([]);
  });
});
