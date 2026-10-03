// Posouzení pádu nasazení: opakovat JEN doloženou přechodnou chybu.
// Vzorky jsou výřezy SKUTEČNÝCH logů Coolify (<fork>-core, 2026-09-22/23), bez tajemství.
import { describe, expect, it } from "vitest";
import { casVydaniZRegistru, klasifikuj, priznaky, rozhodujiciBlok, textLogu } from "./nasazeni-prechodna-chyba.mjs";

// pc2i6yts… 2026-09-23 — závod s vydáním (@sentry/core vyšel 3 min po startu nasazení)
const ZAVOD = [
  "#70 131.1 npm error code ETARGET",
  "#70 131.1 npm error notarget No matching version found for @sentry/core@10.75.3.",
  "#70 131.1 npm error notarget In most cases you or one of your dependencies are requesting",
  "#70 181.7 npm error notarget No matching version found for @sentry/core@10.75.3.",
  '#70 ERROR: process "/bin/sh -c for B in esbuild minio; do …" did not complete successfully: exit code: 1',
  "target plugin-publish-init: failed to solve: process \"/bin/sh -c for B in esbuild minio; do …\" did not complete successfully: exit code: 1",
].join("\n");
// 6qrisfeb… 2026-09-22 — pád při startu kontejnerů, bez podpisu přechodné chyby
const NEZNAMY = [
  "Container migrate-6ecw5gwwcinm-234544989111 Exited",
  "Container svc-plugin-system-6ecw5gwwcinm-234545240319 Starting",
  "Error type: App\\Exceptions\\DeploymentException",
  "Error code: 0",
].join("\n");

const START = new Date("2026-09-23T14:03:18Z");
const TED = new Date("2026-09-23T14:07:30Z");
const registr = (mapa) => async (b, v) => mapa[`${b}@${v}`];

describe("příznaky", () => {
  it("najde chybějící verzi i se scope a bez tečky na konci věty", () => {
    expect(priznaky(ZAVOD).chybiVerze).toEqual([{ balik: "@sentry/core", verze: "10.75.3" }]);
    expect(priznaky("No matching version found for left-pad@1.3.0\n").chybiVerze).toEqual([{ balik: "left-pad", verze: "1.3.0" }]);
  });

  it("text logu složí z JSON pole Coolify i z pole objektů", () => {
    const pole = [{ output: "a" }, { output: "b" }];
    expect(textLogu(JSON.stringify(pole))).toBe("a\nb");
    expect(textLogu(pole)).toBe("a\nb");
  });
});

describe("verdikt", () => {
  it("závod s vydáním (verze vyšla BĚHEM nasazení) = přechodná, se důkazem", async () => {
    const v = await klasifikuj(ZAVOD, {
      casVydani: registr({ "@sentry/core@10.75.3": new Date("2026-09-23T14:06:21Z") }),
      zacatek: START,
      ted: TED,
    });
    expect(v).toMatchObject({ prechodna: true, trida: "npm-zavod-s-vydanim" });
    expect(v.dukaz).toMatch(/3 min PO startu/);
  });

  it("verze, která neexistuje ani teď = chybný pin, NE opakovat", async () => {
    const v = await klasifikuj(ZAVOD, { casVydani: registr({ "@sentry/core@10.75.3": null }), zacatek: START, ted: TED });
    expect(v).toMatchObject({ prechodna: false });
    expect(v.dukaz).toMatch(/chybný pin/);
  });

  it("verze vydaná dávno = jiná vada, NE opakovat", async () => {
    const v = await klasifikuj(ZAVOD, {
      casVydani: registr({ "@sentry/core@10.75.3": new Date("2026-09-01T00:00:00Z") }),
      zacatek: START,
      ted: TED,
    });
    expect(v.prechodna).toBe(false);
  });

  it("registr nejde zeptat = bez měření se neopakuje", async () => {
    const v = await klasifikuj(ZAVOD, { casVydani: registr({}), zacatek: START, ted: TED });
    expect(v.prechodna).toBe(false);
    expect(v.dukaz).toMatch(/nepodařilo zeptat/);
    expect((await klasifikuj(ZAVOD)).prechodna).toBe(false);
  });

  it("neznámý pád = STOP", async () => {
    expect(await klasifikuj(NEZNAMY)).toMatchObject({ prechodna: false, trida: null });
  });

  it("síť a limit registru ve SPADLÉM kroku = přechodné", async () => {
    expect((await klasifikuj("#12 3.2 npm error code ECONNRESET\n#12 ERROR: process \"npm ci\" did not complete successfully\n")).trida).toBe(
      "sit-registru",
    );
    expect(
      (await klasifikuj('ERROR: failed to solve: failed to do request: Head "https://…/manifests/22": dial tcp 1.2.3.4:443: i/o timeout')).trida,
    ).toBe("sit-registru");
    expect(
      (await klasifikuj("#3 [internal] load metadata for node:22\n#3 ERROR: toomanyrequests: You have reached your pull rate limit")).trida,
    ).toBe("limit-registru");
  });

  it("⛔ vada kódu + síťový řádek v JINÉM kroku = STOP (recenze aisha-team 09-23)", async () => {
    const smiseny = [
      "#9 0.4 dial tcp 10.0.0.1:443: i/o timeout",
      "#9 DONE 0.6s",
      "#14 12.1 src/index.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      '#14 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
    ].join("\n");
    expect(rozhodujiciBlok(smiseny)).not.toMatch(/i\/o timeout/);
    expect(await klasifikuj(smiseny)).toMatchObject({ prechodna: false, trida: null });
  });

  it("síťový podpis bez spadlého kroku buildu = STOP (pád mimo build se neopakuje)", async () => {
    const v = await klasifikuj("npm error code ECONNRESET\nContainer x Starting\nError type: DeploymentException");
    expect(v.prechodna).toBe(false);
    expect(v.dukaz).toMatch(/rozhodující chyba/);
  });

  it("verze vydaná víc než okno PŘED startem = STOP (to už není závod)", async () => {
    const v = await klasifikuj(ZAVOD, {
      casVydani: registr({ "@sentry/core@10.75.3": new Date("2026-09-23T13:20:00Z") }), // 43 min před startem
      zacatek: START,
      ted: TED,
    });
    expect(v.prechodna).toBe(false);
  });

  it("plný disk přebije i podpis sítě — opakování by ho zakrylo", async () => {
    const v = await klasifikuj("#5 1.0 npm error code ECONNRESET\n#5 ERROR: write /var/lib/docker/x: no space left on device\n");
    expect(v.prechodna).toBe(false);
    expect(v.dukaz).toMatch(/plný disk/);
  });
});

describe("čas vydání z registru", () => {
  const odpoved = (status, telo) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => telo });

  it("scope se kóduje jako jeden segment a čte se time[verze]", async () => {
    let url = "";
    const d = await casVydaniZRegistru("@sentry/core", "10.75.3", {
      registr: "https://reg.example/",
      fetchImpl: async (u) => {
        url = u;
        return odpoved(200, { time: { "10.75.3": "2026-09-23T14:06:21.124Z" } })();
      },
    });
    expect(url).toBe("https://reg.example/@sentry%2Fcore");
    expect(d?.toISOString()).toBe("2026-09-23T14:06:21.124Z");
  });

  it("404 = neexistuje (null), chyba spojení = neměřeno (undefined)", async () => {
    expect(await casVydaniZRegistru("x", "1.0.0", { fetchImpl: odpoved(404, {}) })).toBeNull();
    expect(await casVydaniZRegistru("x", "1.0.0", { fetchImpl: odpoved(503, {}) })).toBeUndefined();
    expect(
      await casVydaniZRegistru("x", "1.0.0", {
        fetchImpl: async () => {
          throw new Error("ECONNRESET");
        },
      }),
    ).toBeUndefined();
    expect(await casVydaniZRegistru("x", "9.9.9", { fetchImpl: odpoved(200, { versions: { "1.0.0": {} }, time: {} }) })).toBeNull();
  });
});
