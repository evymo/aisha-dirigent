/**
 * Neopakovat měření, které už proběhlo — Integral Design Gate
 *
 * Merge PR do main přehrával celou sadu podruhé nad obsahem, který PR běh právě
 * prohlásil za zelený. Při globální sériové concurrency skupině (`group:
 * aisha-ci-runner`) to nezdvojnásobuje jen náklad, ale i ČEKÁNÍ: každý další PR
 * stojí ve frontě za během, který nic nového neměří.
 *
 * Přeskočit se ale nesmí naivně. Commit status visí na hlavě větve, kdežto CI
 * měří merge commit — takže „PR byl zelený" NEZNAMENÁ „tenhle strom je zelený".
 * Pohnul-li se mezitím main, je to jiný obsah a přeskočení by pustilo do main
 * něco, co nikdo neměřil. To je táž třída jako zelený deploy, který nic
 * nenasadil, jen o patro výš.
 *
 * Bezpečná podmínka je rovnost STROMŮ: `tree(HEAD) == tree(HEAD^2)`. Ta platí
 * právě tehdy, když merge nepřinesl nic nad hlavu PR — z čehož plyne, že base
 * v době běhu byl předkem té hlavy, a tedy že testovaný strom je bajtově tenhle.
 *
 * Tenhle soubor měří tři věci, které to celé drží:
 *   1. detect ten výstup opravdu POČÍTÁ, a to z rovnosti stromů + stavu běhu —
 *      ne z něčeho slabšího, co by se dalo splnit i pro nezměřený obsah;
 *   2. každý job, který něco OVĚŘUJE, je tou podmínkou zajištěn (jinak by úspora
 *      byla jen částečná a nikdo by nevěděl, které lane vlastně přeskočily);
 *   3. žádný DEPLOY job na ní nevisí — smyslem běhu nad main je nasadit, a job,
 *      který by se přeskočil taky, by z toho udělal deploy, co se nekoná.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CI = join(ROOT, ".github/workflows/ci.yml");

type Step = { name?: string; run?: string; id?: string };
type Job = { name?: string; if?: string; needs?: string[] | string; steps?: Step[] };

const wf = yaml.load(readFileSync(CI, "utf8")) as {
  jobs: Record<string, Job>;
  concurrency?: { group?: string };
};

const GUARD = "already_verified";

/**
 * Joby, které běží I nad už změřeným stromem — každý z vlastního důvodu.
 * Seznam je ZÁMĚRNĚ výčtem: nový job se musí buď zajistit podmínkou, nebo se
 * sem zapsat i s důvodem. Mlčky přidat neověřovanou lane tak nejde.
 */
const VZDY: Record<string, string> = {
  detect: "sám tu podmínku počítá",
  "build-runner-health": "always-on ze zásady — down runner musí zčervenat na KAŽDÉM pushi",
  "secret-scan": "levný (~20 s) a bezpečnostní; zopakovat nad main nic nestojí",
  semgrep: "totéž — SAST se nad main přehraje schválně",
  "deploy-extranet": "deploy",
  "deploy-core": "deploy",
  "deploy-n8n": "deploy",
  "deploy-koren": "deploy (po vlnách, 2026-09-16 nahradil deploy-infra)",
  "deploy-stacky": "deploy (po vlnách, 2026-09-16 nahradil deploy-infra)",
  "provision-n8n-content": "navazuje na deploy n8n",
  // Verdikt MUSÍ vydat stav na KAŽDÉM PR, jinak by povinná kontrola na
  // mainu u části PR nikdy nevznikla — a nevzniklá povinná kontrola
  // slití nezpřísní, jen ho zablokuje napořád. Nic neměří: jen sečte,
  // jak dopadly ostatní, takže „přehrát nad změřeným stromem" ho nic
  // nestojí (běh v řádu sekund, bez checkoutu a bez instalace).
  "pr-verdikt": "musí vydat stav na každém PR — je to jediná povinná kontrola mainu",
};

const jobs = Object.entries(wf.jobs);
const jeDeploy = (id: string, j: Job) =>
  id.startsWith("deploy-") || String(j.name ?? "").startsWith("Deploy: ");

describe("Neopakovat měření, které už proběhlo (gate)", () => {
  test("detect vystavuje already_verified", () => {
    const outputs = (wf.jobs.detect as unknown as { outputs?: Record<string, string> }).outputs ?? {};
    expect(Object.keys(outputs), "detect musí ten výstup nabídnout, jinak se na něj nedá odkázat")
      .toContain(GUARD);
  });

  test("počítá se z ROVNOSTI STROMŮ a ze stavu běhu, ne z něčeho slabšího", () => {
    const krok = (wf.jobs.detect.steps ?? []).find((s) => s.id === "verified");
    expect(krok, "krok s id=verified musí existovat").toBeTruthy();
    const run = krok!.run ?? "";

    // Rovnost stromů je jádro důkazu — bez ní by šlo přeskočit i obsah, který
    // vznikl až sloučením s posunutým mainem.
    expect(run, "musí porovnávat strom HEAD se stromem druhého rodiče").toContain("HEAD^2");
    expect(run, "musí porovnávat STROMY, ne SHA commitů").toContain("^{tree}");
    // A samotná rovnost nestačí: ten běh musel být zelený.
    expect(run, "musí číst stav běhu hlavy PR").toContain("/status");
    expect(run, "zelená je jediný stav, který opravňuje přeskočit").toContain("success");
    // Fail-closed: výchozí hodnota je false, přeskakuje se jen po důkazu.
    expect(run, "výchozí hodnota musí být false — bez důkazu se měří").toMatch(/V=false/);
    // Jen nad main; nad PR by přeskočení znamenalo neměřit vůbec nic.
    expect(run, "smí platit jen pro push do main").toContain("refs/heads/main");
  });

  test("každý ověřovací job je tou podmínkou zajištěn", () => {
    const nezajistene = jobs
      .filter(([id]) => !(id in VZDY))
      .filter(([, j]) => !String(j.if ?? "").includes(GUARD))
      .map(([id]) => id);
    expect(
      nezajistene,
      `tyhle joby by se nad už změřeným stromem přehrály znovu. Buď jim doplň ` +
        `\`${GUARD} != 'true'\`, nebo je zapiš do VZDY i s důvodem, proč běžet mají:\n  ` +
        nezajistene.join("\n  ")
    ).toEqual([]);
  });

  /**
   * ⛔ OPRAVENO 2026-08-08 — tenhle test tu stál v podobě „žádný deploy job
   * `already_verified` NEZMIŇUJE" a byl ZELENÝ, zatímco vada, kterou měl chytat,
   * probíhala: deploy joby to slovo neobsahovaly, zato visely na VÝSLEDCÍCH
   * úloh, které ta podmínka vypíná. `skipped` není `success`, takže podmínka
   * byla nesplnitelná právě tehdy, když úspora zabrala — ESDK se mergnul, 27
   * úloh svítilo zeleně a extranet servíroval starý bundle.
   *
   * Měřil se PRAVOPIS (výskyt řetězce) místo VLASTNOSTI (že deploy proběhne).
   * Vlastnost teď měří `deploy-se-nesmi-preskocit` tak, že podmínky VYHODNOTÍ
   * ve světě, kde guard platí. Tady zůstává jen ta jedna věc, kterou vyhodnocení
   * nepokryje: deploy se nesmí tou podmínkou přímo VYPÍNAT.
   */
  test("žádný deploy job se tou podmínkou nevypíná", () => {
    const vypnute = jobs
      .filter(([id, j]) => jeDeploy(id, j))
      .filter(([, j]) => new RegExp(`${GUARD}\\s*!=\\s*'true'`).test(String(j.if ?? "")))
      .map(([id]) => id);
    expect(
      vypnute,
      `deploy se nesmí přeskočit kvůli tomu, že testy už proběhly — smyslem běhu ` +
        `nad main je právě nasadit:\n  ` + vypnute.join("\n  ") +
        `\n\nPOZOR: opačný směr (deploy, který se přeskočí, protože se přeskočily ` +
        `jeho závislosti) tenhle test NEVIDÍ. Ten měří deploy-se-nesmi-preskocit.`
    ).toEqual([]);
  });

  test("seznam VZDY jmenuje jen úlohy, které opravdu existují", () => {
    // Rohatka: po sloučení tří deploy úloh do jedné (2026-08-08) tu zbyly
    // `deploy-web` a `deploy-keycloak` jako mrtvé položky. Mrtvý řádek ve
    // výjimkách je horší než žádný — čte se jako rozhodnutí, které nikdo
    // neudělal, a příští čtenář podle něj usoudí, že ty úlohy pořád jsou.
    const neexistujici = Object.keys(VZDY).filter((id) => !(id in wf.jobs)).sort();
    expect(
      neexistujici,
      `tyhle úlohy v ci.yml UŽ NEJSOU, ale pořád mají výjimku:\n  ` +
        neexistujici.join("\n  ") + `\n\nCO S TÍM: vyškrtnout je z VZDY.`
    ).toEqual([]);
  });

  test("úspora dává smysl jen při sériové frontě — ta tam pořád je", () => {
    // Kdyby concurrency skupina zmizela, běhy by se překrývaly a hlavní důvod
    // (čekání ve frontě) by odpadl; gate by pak měřil něco, co už neplatí.
    expect(
      wf.concurrency?.group,
      "workflow má běhy serializovat na jednu skupinu (jinak přehodnotit i tenhle gate)"
    ).toBeTruthy();
  });
});
