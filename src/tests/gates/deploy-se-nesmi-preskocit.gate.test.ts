/**
 * Brána: nasazení se nesmí přeskočit jen proto, že se přeskočily testy.
 *
 * CO SE STALO (naměřeno 2026-08-08, PO merge #152)
 * ------------------------------------------------
 * `detect` umí prohlásit strom za už změřený — merge nepřinesl nic nad zelenou
 * hlavu PR, tak se testovací úlohy nepřehrávají (`already_verified`). Úspora je
 * v pořádku. Vada byla v tom, na co se deploy ptal:
 *
 *     needs.build-web.result == 'success'
 *
 * `skipped` NENÍ `success`, takže podmínka byla nesplnitelná právě tehdy, když
 * úspora zabrala. Výsledek po merge ESDK: všech 27 úloh zeleně, `Deploy:
 * Extranet` doběhl za 0 s a extranet servíroval bajtově STARÝ bundle. Změřeno
 * na živém artefaktu — `data-archetype` v něm nebyl. Nasadilo se to až ručně.
 *
 * PROČ TO STÁVAJÍCÍ BRÁNA NECHYTILA
 * ---------------------------------
 * `ci-neopakovat-mereni` měla test „žádný deploy job na té podmínce nevisí" a
 * ten byl ZELENÝ — deploy joby slovo `already_verified` opravdu neobsahovaly.
 * Jenže visely na VÝSLEDCÍCH úloh, které ta podmínka vypíná. Brána měřila
 * PRAVOPIS (výskyt řetězce), ne VLASTNOST (že deploy proběhne). Táž třída jako
 * „zelená úloha, která nic nenasadila", jen o patro výš.
 *
 * CO MĚŘÍ TAHLE
 * -------------
 * Podmínky se VYHODNOTÍ. Postaví se svět, ve kterém k vadě došlo —
 *   • push do main, `detect` zelený, `already_verified = 'true'`
 *   • každá úloha, kterou ta podmínka vypíná, má `result = 'skipped'`
 *   • relevance se zapíná po JEDNÉ (aby se poznalo, že deploy jede z KAŽDÉHO
 *     důvodu, kvůli kterému má jet — ne že mu stačí jeden shodou okolností)
 * — a pro každý deploy job se ptá: spustil by ses?
 *
 * Modeluje se i pravidlo běhového prostředí, na kterém padl `deploy-n8n`: job
 * bez `always()` (nebo `!cancelled()`) se přeskočí UŽ TÍM, že se přeskočila
 * jeho závislost, a jeho `if` se ani nevyhodnotí.
 *
 * Brána jde rozsvítit doČervena: smaž `already_verified == 'true'` z kterékoli
 * deploy podmínky a padne. (Ověřeno při psaní — sonda, která to neumí, neměří
 * nic; dnes to tu bylo potřetí.)
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CI = join(ROOT, ".forgejo/workflows/ci.yml");

type Job = { name?: string; if?: string; needs?: string[] | string };
const wf = yaml.load(readFileSync(CI, "utf8")) as { jobs: Record<string, Job> };

const GUARD = "already_verified";
const jobs = Object.entries(wf.jobs);
const needsOf = (j: Job): string[] =>
  Array.isArray(j.needs) ? j.needs : typeof j.needs === "string" ? [j.needs] : [];
/**
 * Co je „nasazení". Kromě `deploy-*` sem patří i `provision-*`: obojí mění
 * PRODUKCI a obojí je tou úsporou ohrožené stejně. `provision-n8n-content` na
 * to doplatil ještě jinak — visel na `deploy-n8n` bez `always()`, takže změna
 * jen ve workflowech (kvůli které ta úloha existuje) se nikdy neprovisionovala.
 */
const jeDeploy = (id: string, j: Job) =>
  id.startsWith("deploy-") ||
  id.startsWith("provision-") ||
  /^(Deploy|Provision): /.test(String(j.name ?? ""));

/** Úlohy, které `already_verified` vypíná — čte se ZE SOUBORU, nepíše se sem. */
const VYPINANE = new Set(
  jobs.filter(([, j]) => new RegExp(`${GUARD}\\s*!=\\s*'true'`).test(String(j.if ?? ""))).map(([id]) => id),
);

// ---------------------------------------------------------------------------
// Vyhodnocovač podmnožiny výrazů GitHub Actions.
//
// Umí přesně to, co `if:` v tomhle souboru používá: && || ! == != závorky,
// řetězcové literály, `always()/cancelled()/success()/failure()` a cesty
// `needs.*.result`, `needs.detect.outputs.*`, `github.*`. Nic víc — parser,
// který by uměl víc, by musel víc i hádat.
// ---------------------------------------------------------------------------
import { vyhodnotit, type Hodnota } from "./lib/ci-vyraz";

/** Které výstupy detectu daný job používá jako DŮVOD, proč nasadit. */
function duvody(vyraz: string): string[] {
  const out = new Set<string>();
  for (const m of vyraz.matchAll(/needs\.detect\.outputs\.([A-Za-z0-9_]+)/g)) {
    if (m[1] === GUARD) continue;
    // ⭐ PODMÍNKA KVALITY NENÍ DŮVOD NASADIT (2026-09-17). Výstup, na který se
    // úloha ptá VÝHRADNĚ jako `!= 'true'` („měnil-li se web, musí být zelené
    // testy"), o relevanci nerozhoduje — tu nese `deploy_apps`. Dokud se za důvod
    // bral každý zmíněný výstup, brána VYŽADOVALA, aby `app=true` nasadil core,
    // edge i extranet — tedy právě ten přesah (run 3750: změna jen v compose
    // integration nasadila všechny tři).
    const jmeno = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const vsechny = [...vyraz.matchAll(new RegExp(`needs\\.detect\\.outputs\\.${jmeno}\\b(\\s*!=\\s*'true')?`, "g"))];
    if (vsechny.every((x) => x[1] !== undefined)) continue;
    out.add(m[1]);
  }
  return [...out];
}

/** Všechny výstupy detectu, na které se kdekoli v souboru někdo ptá. */
const VSECHNY_DUVODY = [...new Set(jobs.flatMap(([, j]) => duvody(String(j.if ?? ""))))];

/** Pravidlo běhového prostředí: bez `always()`/`!cancelled()` sráží přeskočená závislost i job sám. */
const bezijPresPreskocene = (vyraz: string) => /always\(\)|!\s*cancelled\(\)/.test(vyraz);

/** Pořadí, ve kterém lze úlohy vyhodnotit (závislosti dřív). */
function topologicky(): string[] {
  const hotovo = new Set<string>();
  const out: string[] = [];
  const navstiv = (id: string, stack: Set<string>) => {
    if (hotovo.has(id) || stack.has(id) || !(id in wf.jobs)) return;
    stack.add(id);
    for (const n of needsOf(wf.jobs[id])) navstiv(n, stack);
    stack.delete(id);
    hotovo.add(id);
    out.push(id);
  };
  for (const id of Object.keys(wf.jobs)) navstiv(id, new Set());
  return out;
}
const PORADI = topologicky();

/**
 * Appky, které manifest zná — univerzum pro model `deploy_apps`.
 *
 * Týž regulární výraz jako v `scripts/aisha-changed-apps.mjs`, protože ten
 * seznam v CI vyrábí právě on. Kdyby se rozešly, model by měřil jiný svět,
 * než jaký `detect` opravdu vydá.
 */
const VSECHNY_APPKY: string[] = readFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), "utf8")
  .split("\n")
  .map((r) => /^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i.exec(r)?.[1])
  .filter((x): x is string => Boolean(x));

if (VSECHNY_APPKY.length === 0) {
  // Prázdné univerzum by simulaci nezčervenalo — jen by ji ODZBROJILO: každé
  // `contains(deploy_apps, …)` by bylo nepravdivé a brána by mlčky měřila nic.
  throw new Error("deploy-se-nesmi-preskocit: manifest nevydal ANI JEDNU appku — model deploy_apps by byl prázdný.");
}

/**
 * ⭐ SIMULACE CELÉHO BĚHU, ne jen jedné podmínky.
 *
 * První verze téhle brány stavěla svět natvrdo („vypnuté úlohy = skipped,
 * ostatní = success") a kvůli tomu NECHYTILA vadu u `provision-n8n-content`:
 * ta úloha se nepřeskakuje kvůli guardu, ale proto, že se přeskočil SOUROZENEC
 * (`deploy-n8n` neběží, když se změna netýká nodů). Ověřeno negativním testem —
 * brána zůstala zelená nad kódem, který jsem schválně rozbil. Sonda, která
 * nejde rozsvítit doČervena, neměří nic; dnes už počtvrté.
 *
 * Teď se výsledky úloh POČÍTAJÍ: v topologickém pořadí, podle jejich vlastních
 * podmínek, ve světě daném jedním důvodem změny. Odpověď „spustí se deploy?"
 * pak stojí na těch samých pravidlech jako skutečný běh.
 */
function simulovat(duvod: string, guardPlati: boolean): Record<string, string> {
  const svet: Record<string, Hodnota> = {
    "github.event_name": "push",
    "github.ref": "refs/heads/main",
    [`needs.detect.outputs.${GUARD}`]: guardPlati ? "true" : "false",
  };
  for (const d of VSECHNY_DUVODY) svet[`needs.detect.outputs.${d}`] = d === duvod ? "true" : "false";
  // `deploy_apps` NENÍ boolean — je to seznam appek obalený čárkami, proti kterému
  // se podmínky ptají `contains(…, ',core,')`. Hodnota "true" by prošla parserem,
  // ale KAŽDÉ `contains` by bylo nepravdivé a brána by tvrdila, že se ty úlohy
  // nikdy nespustí. Model musí odpovídat tvaru, ne jen typu.
  //
  // ⛔ NAMĚŘENO 2026-08-22. Tady stál RUČNĚ NAPSANÝ seznam `,core,edge,extranet,`.
  // Simulace tím tvrdila „takhle vypadá deploy_apps" o třech appkách z 33.
  // Jakákoli úloha klíčovaná na jinou appku vypadala, že se NIKDY nespustí —
  // brána tedy hlásila vadu tam, kde žádná nebyla, a naopak by neuviděla úlohu,
  // co se opravdu nespouští. Univerzum si brána HLEDÁ, nepíše: bere se z téhož
  // manifestu, ze kterého ho v CI odvozuje `aisha-changed-apps.mjs`.
  svet["needs.detect.outputs.deploy_apps"] =
    duvod === "deploy_apps" ? `,${VSECHNY_APPKY.join(",")},` : ",,";
  for (const id of Object.keys(wf.jobs)) svet[`needs.${id}.result`] = "success";

  const vysledky: Record<string, string> = {};
  for (const id of PORADI) {
    const j = wf.jobs[id];
    const vyraz = String(j.if ?? "");
    let r: string;
    if (id === "detect") {
      r = "success";
    } else if (needsOf(j).some((n) => vysledky[n] === "skipped") && !bezijPresPreskocene(vyraz)) {
      // Přeskočená závislost sráží job dřív, než se jeho podmínka vůbec přečte.
      r = "skipped";
    } else if (vyraz.length === 0) {
      r = "success";
    } else {
      try {
        r = vyhodnotit(vyraz, svet) ? "success" : "skipped";
      } catch {
        r = "?"; // nesrozumitelné hlásí vlastní test — mlčky se to nespolkne
      }
    }
    vysledky[id] = r;
    svet[`needs.${id}.result`] = r;
  }
  return vysledky;
}

describe("brána: nasazení se nesmí přeskočit kvůli úspoře měření", () => {
  const deployJobs = jobs.filter(([id, j]) => jeDeploy(id, j));

  test("měřidlo vůbec něco našlo", () => {
    expect(deployJobs.length, "v ci.yml není ani jedna deploy úloha — brána by neměřila nic").toBeGreaterThan(0);
    expect(
      VYPINANE.size,
      `žádnou úlohu '${GUARD}' nevypíná — pak tahle brána měří neexistující svět`,
    ).toBeGreaterThan(3);
  });

  test("podmínky VŠECH úloh jsou vyhodnotitelné", () => {
    // Simulace stojí na tom, že se přečtou podmínky všech úloh, ne jen deploy —
    // výsledek sousedovy podmínky rozhoduje o tom, jestli deploy vůbec naběhne.
    const nesrozumitelne = Object.entries(simulovat(VSECHNY_DUVODY[0] ?? "", true))
      .filter(([, r]) => r === "?")
      .map(([id]) => id)
      .sort();
    expect(
      nesrozumitelne,
      "podmínky těchhle úloh vyhodnocovač nepřečetl. NEZNAMENÁ to, že jsou špatně —\n" +
        "znamená to, že je tahle brána neměří, a mlčící brána je horší než žádná:\n  " +
        nesrozumitelne.join("\n  "),
    ).toEqual([]);
  });

  test("po merge, jehož strom už byl změřený, se nasazení pořád spustí", () => {
    const hresi: string[] = [];
    for (const [id, j] of deployJobs) {
      for (const duvod of duvody(String(j.if ?? ""))) {
        if (simulovat(duvod, true)[id] === "skipped") {
          hresi.push(`${id}: nespustí se, i když detect hlásí ${duvod}=true`);
        }
      }
    }
    expect(
      hresi,
      "tyhle deploy úlohy by se po merge PŘESKOČILY, přestože se změna týká právě jich:\n  " +
        hresi.join("\n  ") +
        "\n\nCO TO ZNAMENÁ: merge projde zeleně a na produkci zůstane starý artefakt —\n" +
        "přesně stav, který 2026-08-08 nechal extranet o hodinu pozadu za mainem.\n\n" +
        "CO S TÍM: v podmínce nahradit `needs.X.result == 'success'` variantou\n" +
        "`(needs.detect.outputs.already_verified == 'true' || needs.X.result == 'success')`\n" +
        "a doplnit `always()`, pokud tam není. Výjimku `already_verified` dávej DOVNITŘ\n" +
        "větve o výsledcích testů, nikdy před rozhodnutí o RELEVANCI změny.",
    ).toEqual([]);
  });

  test("a spustí se i po BĚŽNÉM merge, kde se testy skutečně měřily", () => {
    // Bez tohohle by šlo bránu ukojit tak, že by deploy jel JEN v úsporném
    // režimu — a tichý regres na plném běhu by nikdo nezachytil.
    const hresi: string[] = [];
    for (const [id, j] of deployJobs) {
      for (const duvod of duvody(String(j.if ?? ""))) {
        if (simulovat(duvod, false)[id] === "skipped") {
          hresi.push(`${id}: nespustí se ani při plném běhu, když detect hlásí ${duvod}=true`);
        }
      }
    }
    expect(
      hresi,
      "tyhle deploy úlohy se nespustí ani po běhu, ve kterém všechny testy proběhly:\n  " +
        hresi.join("\n  "),
    ).toEqual([]);
  });

  test("výjimka nesmí nasazovat i tam, kam se změna netýká", () => {
    // Druhá strana téže mince: `already_verified` smí nahradit důkaz „testy byly
    // zelené", ne otázku „týká se to mě". Kdyby stálo před relevancí, nasazoval
    // by se každý stack při každém merge.
    const vysledky = simulovat("(žádný důvod)", true);
    const prehnane = deployJobs
      .filter(([id, j]) => duvody(String(j.if ?? "")).length > 0 && vysledky[id] === "success")
      .map(([id]) => id);
    expect(
      prehnane,
      "tyhle úlohy by nasadily i po merge, který se jich vůbec netýká:\n  " + prehnane.join("\n  "),
    ).toEqual([]);
  });
});
