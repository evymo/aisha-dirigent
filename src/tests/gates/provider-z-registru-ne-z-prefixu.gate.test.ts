/**
 * Brána: o provideru modelu z registru rozhoduje ŘÁDEK registru, ne prefix jeho id.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (PR #956 a oprava nesouladů). `resolveProvider(modelString)`
 * (services/svc-ai-chat/src/lib/llmRouter.ts) hádá providera z prefixu id; bez prefixu
 * vrací `openai` (nebo `ollama`, když je nastavené OLLAMA_URL). Self-test a benchmark už
 * brali providera z řádku registru, ale dispatch nad modelem, který vydal resolver
 * (`aisha_resolve_clow_backend` → `top.provider_slug` / `top.backend_kind`), ho hádal:
 *   · llmRouter.ts reResolveExcluding    `resolveProvider(top.model_id)`
 *   · nodes/runtime_dispatch.ts          `resolveProvider(backend.model_id)`
 *   · routes/chat.ts kompakce historie   `resolveProvider(compactionModel)` nad `resolveDefaultModel(…)`
 *   · criticLoop.ts, decision.ts         direct_cloud / neznámý druh → `resolveProvider(…model_id)`
 * Model id bez prefixu (alias lokálního modelu, model za llm_gateway `llmgateway-io`)
 * tak odešel k providerovi, který ho neobsluhuje.
 *
 * Vlastnost: ŽÁDNÉ volání `resolveProvider(…)` v provozním kódu služeb nesmí dostat
 * hodnotu z registru/resolveru — výraz s `model_id` / `provider_slug` / `.top`, přímé
 * volání `resolveDefaultModel(` / `resolveSlotModel(`, ani identifikátor, do kterého
 * se v témže souboru přiřadil výsledek těchto zdrojů. Heuristika smí zůstat jen nad ručně
 * psaným id (tělo požadavku, override konfigurace, AISHA_SLOT_MODELS).
 *
 * Co brána NEMĚŘÍ (a je to vyjmenované, ne tiché): cesty, které id z registru pošlou
 * do `resolveAvailableModel(…)` — ten uvnitř taky rozhoduje prefixem (canServe) a řádek
 * registru už nemá, protože `resolveSlotModel` vrací jen id. Stav 2026-09-13:
 * reflection/decision.ts (slot), routes/flowboard-run.ts (profil), unifiedChatStream
 * (llmRouter.ts, Omni /v1 stream) a routes/chat.ts mainAgent.model → workflowEngine.
 * Lokální model to dnes nerozbije jen proto, že svc-model musí alias s prefixem
 * `local-`/`vllm-` deklarovat (lokalni-model-alias-je-deklarace.gate.test.ts).
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SERVICES = join(ROOT, "services");

/**
 * Zdroj bez komentářů a bez OBSAHU řetězců, šablon a regulárních výrazů (oddělovače
 * zůstanou, znaky uvnitř se nahradí mezerou; výrazy `${…}` v šabloně zůstanou kódem).
 * Konce řádků zůstávají, aby sedělo číslo řádku nálezu.
 *
 * ⛔ Změřeno při psaní brány: lexer bez regulárních výrazů a bez vnoření `${…}` se
 * v 7 ze 410 provozních souborů rozešel se skutečností (např. `/["']/` otevřel
 * „řetězec" a zbytek souboru zmizel) — brána by tam byla slepá. Sonda níž drží obě
 * konstrukce.
 */
export function bezKomentaru(src: string): string {
  const prazdne = (t: string) => t.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  // Zásobník: 'code' s hloubkou složených závorek (pro návrat z `${`) nebo 'tpl'.
  const zasobnik: Array<{ druh: "code"; hloubka: number } | { druh: "tpl" }> = [{ druh: "code", hloubka: 0 }];
  let posledniVyznamny = ""; // poslední ne-bílý znak kódu — rozhoduje „/" = dělení, nebo regex
  const muzeRegex = () => posledniVyznamny === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(posledniVyznamny) || /\b(?:return|typeof|case|in|of|void|throw|yield|await)$/.test(out.trimEnd());
  while (i < src.length) {
    const vrchol = zasobnik[zasobnik.length - 1];
    const c = src[i];
    const d = src[i + 1];
    if (vrchol.druh === "tpl") {
      if (c === "\\") { out += prazdne(c + (d ?? "")); i += 2; continue; }
      if (c === "`") { zasobnik.pop(); out += c; posledniVyznamny = c; i++; continue; }
      if (c === "$" && d === "{") { zasobnik.push({ druh: "code", hloubka: 0 }); out += "${"; posledniVyznamny = "{"; i += 2; continue; }
      out += prazdne(c); i++; continue;
    }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      const konec = src.indexOf("*/", i + 2);
      const k = konec === -1 ? src.length : konec + 2;
      out += prazdne(src.slice(i, k)); i = k; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + prazdne(src.slice(i + 1, j)) + (src[j] === c ? c : "");
      i = src[j] === c ? j + 1 : j; posledniVyznamny = c; continue;
    }
    if (c === "`") { zasobnik.push({ druh: "tpl" }); out += c; i++; continue; }
    if (c === "/" && muzeRegex()) {
      let j = i + 1;
      let trida = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") trida = true;
        else if (src[j] === "]") trida = false;
        else if (src[j] === "/" && !trida) break;
        j++;
      }
      if (src[j] === "/") {
        out += "/" + prazdne(src.slice(i + 1, j)) + "/"; i = j + 1; posledniVyznamny = "/"; continue;
      }
    }
    if (c === "{") vrchol.hloubka++;
    if (c === "}") {
      if (vrchol.hloubka === 0 && zasobnik.length > 1) { zasobnik.pop(); out += c; posledniVyznamny = "`"; i++; continue; }
      vrchol.hloubka--;
    }
    if (!/\s/.test(c)) posledniVyznamny = c;
    out += c; i++;
  }
  return out;
}

/** Argumenty volání `jmeno(` (vyvážené závorky), bez definice `function jmeno(`. */
export function argumentyVolani(src: string, jmeno: string): Array<{ radek: number; arg: string }> {
  const out: Array<{ radek: number; arg: string }> = [];
  const re = new RegExp(`(?<![\\w.$])${jmeno}\\s*\\(`, "g");
  for (const m of src.matchAll(re)) {
    const pred = src.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
    if (/function\s+$/.test(pred)) continue;
    let i = (m.index ?? 0) + m[0].length;
    let hloubka = 1;
    const od = i;
    for (; i < src.length && hloubka > 0; i++) {
      if (src[i] === "(") hloubka++;
      else if (src[i] === ")") hloubka--;
    }
    out.push({ radek: src.slice(0, m.index).split("\n").length, arg: src.slice(od, i - 1) });
  }
  return out;
}

const ZDROJ_REGISTRU = /\bmodel_id\b|\bprovider_slug\b|\.top\b|\bresolveDefaultModel\s*\(|\bresolveSlotModel\s*\(/;

/**
 * Identifikátory, do kterých se v souboru přiřadila hodnota ze zdroje registru.
 *
 * Pravá strana se čte od `=` k nejbližšímu `;` pro KAŽDOU deklaraci zvlášť. ⛔ Změřeno
 * při psaní brány: jeden regex `=([^;]*)` přes `matchAll` nepřekrývá shody, takže vnější
 * `const compaction = await compactHistoryIfNeeded({ … summarize: … })` spolkl vnořenou
 * `const compactionModel = await resolveDefaultModel(…)` a skutečná vada v routes/chat.ts
 * by prošla.
 */
export function identifikatoryZRegistru(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=(?!=)/g)) {
    const od = (m.index ?? 0) + m[0].length;
    const konec = src.indexOf(";", od);
    if (ZDROJ_REGISTRU.test(src.slice(od, konec === -1 ? src.length : konec))) out.add(m[1]);
  }
  return out;
}

/** Nálezy `resolveProvider(…)` nad hodnotou z registru v jednom zdroji. */
export function nalezy(src: string): Array<{ radek: number; arg: string }> {
  const kod = bezKomentaru(src);
  const zRegistru = identifikatoryZRegistru(kod);
  return argumentyVolani(kod, "resolveProvider").filter(({ arg }) => {
    if (ZDROJ_REGISTRU.test(arg)) return true;
    return [...arg.matchAll(/[A-Za-z_$][\w$]*/g)].some((m) => zRegistru.has(m[0]));
  });
}

function provozniZdroje(dir: string): string[] {
  const out: string[] = [];
  for (const jmeno of readdirSync(dir)) {
    if (jmeno === "node_modules" || jmeno === "dist" || jmeno === "tests" || jmeno === "__tests__") continue;
    const cesta = join(dir, jmeno);
    if (statSync(cesta).isDirectory()) out.push(...provozniZdroje(cesta));
    else if (/\.(ts|tsx|mts)$/.test(jmeno) && !/\.(test|spec)\.[mc]?tsx?$/.test(jmeno) && !/\.d\.ts$/.test(jmeno)) out.push(cesta);
  }
  return out;
}

describe("provider modelu z registru se čte z řádku, ne z prefixu id", () => {
  const soubory = readdirSync(SERVICES)
    .map((s) => join(SERVICES, s, "src"))
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(provozniZdroje);

  test("fixture: univerzum obsahuje router i všechna místa, kde se to stalo", () => {
    const rel = soubory.map((f) => relative(ROOT, f));
    expect(soubory.length).toBeGreaterThan(200);
    for (const f of [
      "services/svc-ai-chat/src/lib/llmRouter.ts",
      "services/svc-ai-chat/src/reflection/nodes/runtime_dispatch.ts",
      "services/svc-ai-chat/src/routes/chat.ts",
      "services/svc-ai-chat/src/lib/criticLoop.ts",
      "services/svc-ai-chat/src/reflection/decision.ts",
    ]) {
      expect(rel, f).toContain(f);
    }
  });

  test("měřidlo vidí celé soubory: lexer nezakryje žádný řádek import/export (jinak by brána byla slepá)", () => {
    const slepe: string[] = [];
    for (const f of soubory) {
      const puvodni = readFileSync(f, "utf-8").split("\n");
      const kod = bezKomentaru(puvodni.join("\n")).split("\n");
      if (kod.length !== puvodni.length) slepe.push(`${relative(ROOT, f)}: počet řádků`);
      const i = puvodni.findIndex((r, n) => /^(import|export) /.test(r) && !/^(import|export) /.test(kod[n] ?? ""));
      if (i !== -1) slepe.push(`${relative(ROOT, f)}:${i + 1}`);
    }
    expect(slepe).toEqual([]);
  });

  test("⛔ žádné resolveProvider(…) nad hodnotou z registru/resolveru", () => {
    const vse = soubory.flatMap((f) =>
      nalezy(readFileSync(f, "utf-8")).map((n) => `${relative(ROOT, f)}:${n.radek}: resolveProvider(${n.arg.trim()})`),
    );
    expect(
      vse,
      "Model z registru nese providera ve svém řádku — `providerForResolvedBackend(top)` / " +
        "`providerForRegistryRow(row.provider)` (services/svc-ai-chat/src/lib/providerIdentity.ts), " +
        "u výchozího modelu `resolveDefaultBackend(…)`. resolveProvider je jen pro ručně psané id.",
    ).toEqual([]);
  });

  test("negativní sonda: přesně ty tvary, které byly v kódu, jsou nález", () => {
    const pred = [
      "const provider = resolveProvider(top.model_id);",
      "model: backend?.model_id ? { provider: resolveProvider(backend.model_id), model_id: backend.model_id } : null,",
      "const compactionModel = await resolveDefaultModel('chat.history_compaction', { maxCostUsd: 0.01 });\nconst r = await unifiedChat({ provider: resolveProvider(compactionModel), model: compactionModel });",
      "return resolveProvider(clow.model_id ?? '');",
      "const preferred = await resolveSlotModel(slot, profile);\nconst p = resolveProvider(preferred);",
      // vnořená deklarace uvnitř vnější bez středníku (tvar routes/chat.ts před opravou)
      "const compaction = await compactHistoryIfNeeded({\n  summarize: async () => {\n    const compactionModel = await resolveDefaultModel('x', {\n      maxCostUsd: 0.01,\n    });\n    return unifiedChat({ provider: resolveProvider(compactionModel) });\n  },\n});",
    ];
    for (const kod of pred) expect(nalezy(kod).length, kod).toBe(1);
  });

  test("negativní sonda: ručně psané id, komentář a definice nálezem NEJSOU", () => {
    const ok = [
      "provider = resolveProvider(body.model);",
      "provider: resolveProvider(modelOverride),",
      "// dřív: resolveProvider(top.model_id)\nconst x = 1;",
      "/* resolveProvider(backend.model_id) */",
      "export function resolveProvider(modelString: string): LlmProvider {",
      "const provider = args.provider ?? resolveProvider(args.model);",
      "const url = 'http://x//resolveProvider(top.model_id)';",
    ];
    for (const kod of ok) expect(nalezy(kod), kod).toEqual([]);
  });

  test("negativní sonda lexeru: regex s uvozovkou ani šablona s `${…}` nezakryjí kód za sebou", () => {
    const zaRegexem = "const re = /[\"']/g;\nconst provider = resolveProvider(top.model_id);";
    expect(nalezy(zaRegexem).length, "regex s uvozovkou otevřel „řetězec\"").toBe(1);
    const zaSablonou = "const t = `a ${x ? `b` : 'c'} d`;\nconst provider = resolveProvider(top.model_id);";
    expect(nalezy(zaSablonou).length, "vnořená šablona ukončila vnější").toBe(1);
    const deleni = "const a = b / 2; const c = d / 3;\nconst provider = resolveProvider(top.model_id);";
    expect(nalezy(deleni).length, "dělení se četlo jako regex").toBe(1);
  });
});
