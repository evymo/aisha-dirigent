import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { vyberNavazani } from "./nasazeni-navazani.mjs";

// Skutečný TVAR položky z `/api/v1/deployments/applications/<uuid>` (naměřeno 09-23, anonymizováno).
const VZOR = JSON.parse(readFileSync("src/tests/gates/fixtures/coolify-nasazeni-aplikace.json", "utf8")).deployments[0];
const SHA = "a".repeat(40);
const CIZI = "b".repeat(40);
const OD = Date.parse("2026-10-01T15:00:00Z") / 1000;
const nas = (uuid, created, commit, status) => ({ ...VZOR, deployment_uuid: uuid, created_at: created, commit, status });
const odp = (...d) => ({ count: d.length, deployments: d });

describe("na co pokračování naváže", () => {
  it("v tomto běhu nenasazeno → nasadit; starší nasazení (i cizí revize) se nepočítá", () => {
    const v = vyberNavazani(odp(nas("stare", "2026-10-01T14:10:00.000000Z", CIZI, "finished")), { od: OD, sha: SHA });
    expect(v).toMatchObject({ akce: "nasadit", uuid: "" });
  });

  it("nejnovější nasazení běhu běží → navázat, hotové → ověřit, spadlé → nasadit znovu", () => {
    for (const [stav, akce] of [["in_progress", "navazat"], ["queued", "navazat"], ["finished", "overit"], ["failed", "nasadit"]]) {
      const v = vyberNavazani(odp(nas("n1", "2026-10-01T15:05:00.000000Z", SHA, stav)), { od: OD, sha: SHA });
      expect(v, stav).toMatchObject({ akce, uuid: "n1", stav });
    }
  });

  it("víc nasazení téže revize → bere se NEJNOVĚJŠÍ (např. operátor mezitím pustil cold-start)", () => {
    const v = vyberNavazani(
      odp(nas("prvni", "2026-10-01T15:05:00.000000Z", SHA, "failed"), nas("druhe", "2026-10-01T15:20:00.000000Z", SHA, "in_progress")),
      { od: OD, sha: SHA },
    );
    expect(v).toMatchObject({ akce: "navazat", uuid: "druhe" });
  });

  it("⛔ nasazení s JINOU revizí po začátku běhu = sloučeno během nasazení, i když existuje novější naše", () => {
    const v = vyberNavazani(
      odp(nas("nase", "2026-10-01T15:25:00.000000Z", SHA, "finished"), nas("cizi", "2026-10-01T15:10:00.000000Z", CIZI, "finished")),
      { od: OD, sha: SHA },
    );
    expect(v.akce).toBe("cizi_sha");
    expect(v.detail).toContain(`během nasazení bylo sloučeno: ${CIZI}`);
  });

  it("⛔ nasazení bez revize nebo neznámý stav = nejasné, ne odhad", () => {
    expect(vyberNavazani(odp(nas("h", "2026-10-01T15:05:00.000000Z", "HEAD", "finished")), { od: OD, sha: SHA }).akce).toBe("nejasne");
    expect(vyberNavazani(odp(nas("x", "2026-10-01T15:05:00.000000Z", SHA, "paused")), { od: OD, sha: SHA }).akce).toBe("nejasne");
  });

  it("bez razítka, bez revize nebo bez seznamu nerozhoduje", () => {
    expect(() => vyberNavazani(odp(), { od: NaN, sha: SHA })).toThrow(/razítko/);
    expect(() => vyberNavazani(odp(), { od: OD, sha: "main" })).toThrow(/není sha/);
    expect(() => vyberNavazani({ zprava: "x" }, { od: OD, sha: SHA })).toThrow(/seznam/);
  });

  it("CLI vrací akci jako TSV, nečitelný vstup = kód 2", () => {
    const ok = spawnSync("node", ["scripts/lib/nasazeni-navazani.mjs", "--od", String(OD), "--sha", SHA], {
      input: JSON.stringify(odp(nas("n1", "2026-10-01T15:05:00.000000Z", SHA, "in_progress"))),
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim().split("\t").slice(0, 3)).toEqual(["navazat", "n1", "in_progress"]);
    const spatne = spawnSync("node", ["scripts/lib/nasazeni-navazani.mjs", "--od", String(OD), "--sha", SHA], { input: "{", encoding: "utf8" });
    expect(spatne.status).toBe(2);
  });
});
