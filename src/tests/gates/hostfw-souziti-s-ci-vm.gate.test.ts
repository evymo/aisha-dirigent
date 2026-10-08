/**
 * Brána: hostitelský firewall (infra/accel/hostfw.sh) se SNESE s CI VM na témže
 * hostiteli — po nasazení i po návratu jsou cizí řetězce a pravidla beze změny.
 *
 * Dohoda s Android (ACCEL_PLANE.md, „Soužití s CI VM"): na GPU hostiteli je most
 * CI VM, jeho vlastní nftables tabulky a dvě pravidla v DOCKER-USER jen pro ten
 * most. hostfw na ně NESMÍ sáhnout: pravidla jen ve vlastních řetězcích, do
 * DOCKER-USER jen skok podmíněný dockerovým mostem, nic neflushovat, auto-návrat
 * sundá jen svoje.
 *
 * Žádný skutečný hostitel: simulace (lib/hostfw-postroj.ts) — falešné iptables
 * nad JSON stavem, falešné `ip`, falešné `nft`, které se zapíše a selže.
 * Skutečný hostfw.sh běží jako proces (měří se chování, ne text).
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  ROZHRANI,
  ciziBezSkoku,
  postroj,
  prikaz,
  skokyHostfw,
  spustit,
  vychoziStav,
  type Postroj,
} from "./lib/hostfw-postroj";

// Proces hostfw.sh volá falešné iptables desítkykrát (každé volání = start Node);
// pod zátěží sdíleného stroje (load 50+, 8 workerů bran) to trvá i minutu.
// Strop výslovně; soubor je v těžké dráze (lanes.json).
const STROP_MS = 300_000;
const zastavit: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (zastavit.length) await zastavit.pop()!();
});
function beh(p: Postroj, extra: Record<string, string> = {}) {
  const b = spustit(p, extra);
  zastavit.push(b.zastav);
  return b;
}
const nftNikdy = (p: Postroj) => expect(existsSync(p.logNft) ? readFileSync(p.logNft, "utf8") : "", "hostfw volal nft").toBe("");

describe("soužití s CI VM: cizí řetězce a pravidla beze změny", () => {
  it("measure: po nasazení jen vlastní řetězce + skoky; po --vrat přesně výchozí stav", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { ACCEL_FW_MODE: "measure" });
    expect(await b.cekej(["MERENI", "SELHALO"])).toBe("MERENI");
    const po = p.cti();
    expect(ciziBezSkoku(po), "cizí řetězce se změnily").toEqual(ciziBezSkoku(vychozi));
    expect(po.nft, "nftables tabulky CI VM").toEqual(vychozi.nft);
    for (const rod of ["4", "6"] as const) {
      expect(skokyHostfw(po, rod).sort()).toEqual(
        [
          `DOCKER-USER -i ${ROZHRANI} -o br-+ -m comment --comment aisha-hostfw -j AISHA-HOSTFW-FWD`,
          `DOCKER-USER -i ${ROZHRANI} -o docker0 -m comment --comment aisha-hostfw -j AISHA-HOSTFW-FWD`,
          `INPUT -i ${ROZHRANI} -m comment --comment aisha-hostfw -j AISHA-HOSTFW-IN`,
        ],
      );
      // Pravidla CI VM v DOCKER-USER pořád na místě a v původním pořadí.
      expect(po.tabulky[rod]["DOCKER-USER"].pravidla.map((x) => x.spec).filter((x) => !x.includes("AISHA-HOSTFW"))).toEqual(
        vychozi.tabulky[rod]["DOCKER-USER"].pravidla.map((x) => x.spec),
      );
      expect(po.tabulky[rod]["AISHA-HOSTFW-IN"].pravidla.some((x) => x.spec.endsWith("-j DROP")), "measure nesmí zahazovat").toBe(false);
    }
    expect(prikaz(p, "--zdravi").kod).toBe(0);
    await b.zastav();
    const v = prikaz(p, "--vrat");
    expect(v.kod, v.out + v.err).toBe(0);
    expect(p.cti().tabulky, "po návratu se stav musí rovnat výchozímu").toEqual(vychozi.tabulky);
    nftNikdy(p);
    // Žádné volání restore bez --noflush, žádné -F/-X/-P na cizí řetězce.
    const log = readFileSync(p.logIpt, "utf8");
    expect(log).not.toMatch(/-restore(?![^\n]*--noflush)/);
    expect(log).not.toMatch(/ -[FX] (INPUT|FORWARD|OUTPUT|DOCKER-USER|DOCKER-FORWARD|DOCKER)\b/);
    expect(log).not.toMatch(/ -P /);
  }, STROP_MS);

  it("⛔ enforce bez nového SSH ze správy: auto-návrat sundá JEN svoje → výchozí stav, VRACENO, unhealthy", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_CONFIRM_S: "10" });
    expect(await b.cekej(["CEKA_NA_POTVRZENI"])).toBe("CEKA_NA_POTVRZENI");
    expect(p.cti().tabulky["4"]["AISHA-HOSTFW-IN"].pravidla.at(-1)?.spec).toMatch(/-j DROP$/);
    expect(prikaz(p, "--zdravi").kod, "čekání na potvrzení není zdraví").not.toBe(0);
    expect(await b.cekej(["VRACENO", "VYNUCENO"])).toBe("VRACENO");
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
    expect(prikaz(p, "--zdravi").kod).not.toBe(0);
    nftNikdy(p);
  }, STROP_MS);

  it("enforce potvrzený novým SSH ze správy; restart s TOUŽ sadou nic nepřepíše a nečeká znovu", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_CONFIRM_S: "60" });
    await b.cekej(["CEKA_NA_POTVRZENI"]);
    p.pakety("4", "-s 192.0.2.10/32 -p tcp --dport 22", 1); // SYN z jedné adresy správy prošel pravidlem SSH
    expect(await b.cekej(["VYNUCENO", "VRACENO"])).toBe("VYNUCENO");
    const potvrzeno = p.cti();
    expect(potvrzeno.tabulky["4"]["AISHA-HOSTFW-IN"].pravidla.some((x) => /aisha-hostfw:potvrzeno:\d+/.test(x.spec))).toBe(true);
    expect(ciziBezSkoku(potvrzeno)).toEqual(ciziBezSkoku(vychozi));
    expect(prikaz(p, "--zdravi").kod).toBe(0);
    await b.zastav();

    const b2 = beh(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_CONFIRM_S: "60" });
    expect(await b2.cekej(["VYNUCENO", "CEKA_NA_POTVRZENI"])).toBe("VYNUCENO");
    expect(await b2.cekejNaLog(/beze změny/)).toMatch(/beze změny/);
    // Čítač správy přežil — sada se nepřepisovala.
    const ssh = p.cti().tabulky["4"]["AISHA-HOSTFW-IN"].pravidla.filter((x) => x.spec.includes("aisha-hostfw:sprava"));
    expect(ssh.reduce((n, x) => n + x.pkts, 0)).toBe(1);
  }, STROP_MS);

  it("smyčka doplní chybějící skok (Docker restart DOCKER-USER vyprázdní) a cizí pravidla nechá", async () => {
    const p = postroj();
    const b = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_FW_INTERVAL_S: "5" });
    await b.cekej(["MERENI"]);
    const s = p.cti();
    s.tabulky["4"]["DOCKER-USER"].pravidla = s.tabulky["4"]["DOCKER-USER"].pravidla.filter((x) => !x.spec.includes("AISHA-HOSTFW"));
    p.zapis(s);
    const konec = Date.now() + 150_000;
    while (Date.now() < konec && skokyHostfw(p.cti(), "4").filter((x) => x.startsWith("DOCKER-USER")).length < 2) {
      await new Promise((ok) => setTimeout(ok, 500));
    }
    expect(skokyHostfw(p.cti(), "4").filter((x) => x.startsWith("DOCKER-USER"))).toHaveLength(2);
    expect(ciziBezSkoku(p.cti())).toEqual(ciziBezSkoku(vychoziStav()));
  }, STROP_MS);
});

describe("fail-closed: neplatný vstup = žádná pravidla, unhealthy", () => {
  // Zápis do iptables = cokoli, co mění tabulku (čtení -S/-L/-C/-V a save ne).
  const zapisy = (p: Postroj) =>
    readFileSync(p.logIpt, "utf8").split("\n").filter((l) => /(^|\s)-(A|I|D|F|X|N|P|R|Z|E)(\s|$)|-restore/.test(l));

  it("⛔ F2: dva forky, které se OBA deklarují jako vlastník uzlu — druhý přečte vlastníka z řetězců na uzlu (aisha-hostfw:vlastnik:…) a STOP bez jediného zápisu; --vrat druhého nic; řetězce bez identity také STOP; KOTVA: týž vlastník znovu = idempotentně beze změny", async () => {
    const p = postroj();
    const b = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-b", ACCEL_FW_NODE_OWNER: "vrstva-b" });
    expect(await b.cekej(["MERENI", "SELHALO"]), "kotva: fork B (deklarovaný vlastník) naběhne").toBe("MERENI");
    await b.zastav();
    const pravidlaB = p.cti();
    for (const rod of ["4", "6"] as const) {
      for (const ret of ["AISHA-HOSTFW-IN", "AISHA-HOSTFW-FWD"]) {
        expect(pravidlaB.tabulky[rod][ret].pravidla[0].spec, `IPv${rod} ${ret}: první pravidlo nese identitu vlastníka`).toMatch(/--comment aisha-hostfw:vlastnik:vrstva-b /);
      }
    }

    // Fork A se taky deklaruje vlastníkem (A = A) — strážce deklarace ho pustí, uzel ne.
    writeFileSync(p.logIpt, "");
    const a = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-a", ACCEL_FW_NODE_OWNER: "vrstva-a" });
    expect(await a.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(await a.cekejNaLog(/řetězec AISHA-HOSTFW-IN patří vlastníkovi vrstva-b, ne vrstva-a — dva firewally na jednom stroji; STOP, pravidla se nemění/)).toMatch(/řetězec AISHA-HOSTFW-IN patří vlastníkovi vrstva-b, ne vrstva-a — dva firewally na jednom stroji; STOP, pravidla se nemění/);
    expect(zapisy(p), "druhý firewall nesmí zapsat nic").toEqual([]);
    expect(p.cti(), "pravidla vlastníka B beze změny").toEqual(pravidlaB);
    await a.zastav();
    const vrat = prikaz(p, "--vrat", { ACCEL_OWNER_PREFIX: "vrstva-a", ACCEL_FW_NODE_OWNER: "vrstva-a" });
    expect(vrat.kod).toBe(1);
    expect(zapisy(p), "--vrat cizího nesundává").toEqual([]);
    expect(p.cti()).toEqual(pravidlaB);

    // KOTVA: vlastník B znovu — vlastní značka = pokračuje, a protože sada sedí, nic nepřepisuje.
    writeFileSync(p.logIpt, "");
    const b2 = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-b", ACCEL_FW_NODE_OWNER: "vrstva-b" });
    expect(await b2.cekej(["MERENI", "SELHALO"])).toBe("MERENI");
    expect(await b2.cekejNaLog(/vlastní pravidla už odpovídají plánu — beze změny/)).toMatch(/vlastní pravidla už odpovídají plánu — beze změny/);
    expect(zapisy(p)).toEqual([]);
    await b2.zastav();

    // Řetězce BEZ identity vlastníka (ruční zásah, starší verze): nevím čí — STOP, nic.
    const bezIdentity = JSON.parse(JSON.stringify(pravidlaB).split("aisha-hostfw:vlastnik:vrstva-b").join("aisha-hostfw"));
    p.zapis(bezIdentity);
    writeFileSync(p.logIpt, "");
    const c = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-b", ACCEL_FW_NODE_OWNER: "vrstva-b" });
    expect(await c.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(await c.cekejNaLog(/existuje bez identity vlastníka — nevím čí; nesahám/)).toMatch(/existuje bez identity vlastníka — nevím čí; nesahám/);
    expect(zapisy(p)).toEqual([]);
    expect(p.cti()).toEqual(bezIdentity);
  }, STROP_MS);

  it("⛔ F2: firewall s NEPLATNOU deklarací na uzlu s řetězci jiného vlastníka nic nesundá (selhání sundává jen vlastní)", async () => {
    const p = postroj();
    const b = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-b", ACCEL_FW_NODE_OWNER: "vrstva-b" });
    expect(await b.cekej(["MERENI"])).toBe("MERENI");
    await b.zastav();
    const pravidlaB = p.cti();
    writeFileSync(p.logIpt, "");
    const a = beh(p, { ACCEL_FW_MODE: "zapnuto", ACCEL_OWNER_PREFIX: "vrstva-a", ACCEL_FW_NODE_OWNER: "vrstva-a" });
    expect(await a.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(await a.cekejNaLog(/nesundávám nic: IPv4: řetězec AISHA-HOSTFW-IN patří vlastníkovi vrstva-b/)).toMatch(/nesundávám nic: IPv4: řetězec AISHA-HOSTFW-IN patří vlastníkovi vrstva-b/);
    expect(zapisy(p)).toEqual([]);
    expect(p.cti()).toEqual(pravidlaB);
  }, STROP_MS);

  it("⛔ dva firewally na jednom stroji: cizí identita vrstvy (není vlastník uzlu) po nasazení vlastníka = SELHALO s příčinou, ŽÁDNÉ volání iptables, pravidla vlastníka beze změny; --vrat cizího také nic; KOTVA: vlastník naběhne", async () => {
    const p = postroj();
    const vlastnik = beh(p, { ACCEL_FW_MODE: "measure" });
    expect(await vlastnik.cekej(["MERENI", "SELHALO"]), "kotva: vlastník uzlu naběhne").toBe("MERENI");
    await vlastnik.zastav();
    const pravidlaVlastnika = p.cti();
    expect(skokyHostfw(pravidlaVlastnika, "4").length, "kotva: vlastník pravidla opravdu nasadil").toBeGreaterThan(0);

    writeFileSync(p.logIpt, "");
    const cizi = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_OWNER_PREFIX: "vrstva-b" });
    expect(await cizi.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(await cizi.cekejNaLog(/ACCEL_OWNER_PREFIX='vrstva-b' NENÍ vlastník uzlu \(ACCEL_FW_NODE_OWNER='vrstva-a'\)/)).toMatch(/ACCEL_OWNER_PREFIX='vrstva-b' NENÍ vlastník uzlu \(ACCEL_FW_NODE_OWNER='vrstva-a'\)/);
    expect(readFileSync(p.logIpt, "utf8"), "cizí firewall nesmí volat iptables vůbec (ani zjišťovat, ani sundávat)").toBe("");
    expect(p.cti(), "pravidla vlastníka se nezměnila").toEqual(pravidlaVlastnika);
    expect(readFileSync(join(p.stavDir, "stav"), "utf8")).toMatch(/^duvod=nejsem vlastník uzlu — ACCEL_OWNER_PREFIX='vrstva-b'/m);
    await cizi.zastav();

    const vrat = prikaz(p, "--vrat", { ACCEL_OWNER_PREFIX: "vrstva-b" });
    expect(vrat.kod).toBe(1);
    expect(readFileSync(p.logIpt, "utf8"), "--vrat cizího nesahá na pravidla").toBe("");
    expect(p.cti()).toEqual(pravidlaVlastnika);

    // Nedeklarovaný vlastník uzlu je totéž: nevím, kdo smí — nesahám.
    const nevim = beh(p, { ACCEL_FW_MODE: "measure", ACCEL_FW_NODE_OWNER: "" });
    expect(await nevim.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(readFileSync(p.logIpt, "utf8")).toBe("");
    expect(p.cti()).toEqual(pravidlaVlastnika);
  }, STROP_MS);

  it("⛔ neznámý režim po předchozím nasazení: vlastní pravidla sundá, cizí nechá, SELHALO", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { ACCEL_FW_MODE: "measure" });
    await b.cekej(["MERENI"]);
    await b.zastav();
    const b2 = beh(p, { ACCEL_FW_MODE: "zapnuto" });
    expect(await b2.cekej(["SELHALO", "MERENI", "VYNUCENO"])).toBe("SELHALO");
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
    expect(prikaz(p, "--zdravi").kod).not.toBe(0);
  }, STROP_MS);

  it("⛔ prázdné adresy správy: žádný DROP, nic nenasazeno", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_ADMIN_CIDRS: "" });
    expect(await b.cekej(["SELHALO", "CEKA_NA_POTVRZENI"])).toBe("SELHALO");
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
  }, STROP_MS);

  it("⛔ neznámý přepínač DRY_RUN (ani 0, ani 1) se nevykládá: SELHALO a nic se nezapíše; kotvy: 1 = náhled bez zápisu, 0 = ostrý běh", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const neznamy = beh(p, { DRY_RUN: "true" });
    expect(await neznamy.cekej(["SELHALO", "MERENI", "NAHLED"])).toBe("SELHALO");
    expect(await neznamy.cekejNaLog(/DRY_RUN='true' není 0 ani 1 — neznámý přepínač, firewall NENABĚHNE/)).toMatch(/DRY_RUN='true' není 0 ani 1 — neznámý přepínač, firewall NENABĚHNE/);
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
    expect(prikaz(p, "--zdravi").kod).not.toBe(0);
    await neznamy.zastav();

    const nahled = beh(p, { DRY_RUN: "1" });
    expect(await nahled.cekej(["NAHLED", "MERENI", "SELHALO"])).toBe("NAHLED");
    expect(await nahled.cekejNaLog(/PLÁN \(DRY_RUN — nic se nemění\): režim=measure ssh=sprava rozhraní=verejne0 backend=nft /)).toMatch(/PLÁN \(DRY_RUN — nic se nemění\): režim=measure ssh=sprava rozhraní=verejne0 backend=nft /);
    expect(p.cti().tabulky, "náhled nesmí zapsat nic").toEqual(vychozi.tabulky);
    await nahled.zastav();

    const ostry = beh(p, { DRY_RUN: "0" });
    expect(await ostry.cekej(["MERENI", "NAHLED", "SELHALO"])).toBe("MERENI");
  }, STROP_MS);

  it("⛔ `iptables -V` v kontejneru hlásí jiný backend než Docker: nic se nezapíše", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const b = beh(p, { FALESNE_IPT_V: "iptables v1.8.11 (legacy)" });
    expect(await b.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(await b.cekejNaLog(/hlásí/)).toMatch(/hlásí/);
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
    expect(readFileSync(p.logIpt, "utf8")).not.toMatch(/ -[IADFX] |-restore/);
  }, STROP_MS);

  it("⛔ DOCKER-USER nikde (Docker neběží / nativní nftables): nic se nezapíše", async () => {
    const vychozi = vychoziStav();
    delete (vychozi.tabulky["4"] as Record<string, unknown>)["DOCKER-USER"];
    vychozi.tabulky["4"].FORWARD.pravidla = [];
    const p = postroj(vychozi);
    const b = beh(p);
    expect(await b.cekej(["SELHALO", "MERENI"])).toBe("SELHALO");
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
  }, STROP_MS);

  it("⛔ legacy backend se nepouští naslepo: bez legacy tabulky filter v jádře se iptables-legacy nevolá", async () => {
    const p = postroj();
    const b = beh(p, { ACCEL_FW_MODE: "measure" });
    await b.cekej(["MERENI"]);
    expect(readFileSync(p.logIpt, "utf8")).not.toMatch(/^iptables-legacy /m);
  }, STROP_MS);

  it("mutace chování: skript s restore BEZ --noflush nenaběhne — simulace ho odmítne, cizí stav celý", async () => {
    const p = postroj();
    const vychozi = p.cti();
    const zdroj = readFileSync(join(process.cwd(), "infra/accel/hostfw.sh"), "utf8");
    const adr = mkdtempSync(join(tmpdir(), "hostfw-mutace-"));
    const kopie = join(adr, "hostfw.sh");
    const zmeneny = zdroj
      .replace('KOREN="$(cd "$(dirname "$0")/../.." && pwd)"', `KOREN="${process.cwd()}"`)
      .replace('"iptables-$BACKEND-restore" --noflush -w', '"iptables-$BACKEND-restore" -w');
    expect(zmeneny).not.toBe(zdroj);
    writeFileSync(kopie, zmeneny);
    const proc = spawn("sh", [kopie], { env: p.env({ ACCEL_FW_MODE: "measure" }) });
    zastavit.push(() => new Promise<void>((ok) => { proc.once("exit", () => ok()); proc.kill("SIGTERM"); }));
    const konec = Date.now() + 150_000;
    while (Date.now() < konec && p.stavHostfw() !== "SELHALO") await new Promise((ok) => setTimeout(ok, 200));
    expect(p.stavHostfw()).toBe("SELHALO");
    expect(p.cti().tabulky).toEqual(vychozi.tabulky);
  }, STROP_MS);
});
