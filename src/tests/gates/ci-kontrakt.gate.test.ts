/**
 * Brána: co čtou workflow CI (`secrets.X`, `vars.X`), má v KONTRAKT_CI domov —
 * odkud to pochází a jestli bez toho CI funguje.
 *
 * ⛔ NAMĚŘENO 2026-09-27: workflow odkazují 49 jmen a ~35 z nich neexistuje
 * v repu, ve forku ani v organizaci. Krok se spustí s prázdnou hodnotou a nic to
 * neřekne. Report (`scripts/lib/ci-kontrakt.mjs`) umí změřit jen to, co kontrakt
 * zná — proto se nové jméno bez zařazení nesmí dostat do workflow.
 *
 * Ráčna (ci-kontrakt.baseline.json) je MNOŽINA dnes nezařazených jmen: vypadnout
 * smí (a musí, jakmile se jméno zařadí nebo ho nic nečte), přibýt ne.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KONTRAKT_CI,
  OVEROVACE,
  klicKontraktuDoktora,
  nactiWorkflow,
  nalezyKontraktu,
  referenceWorkflow,
} from "../../../scripts/lib/ci-kontrakt.mjs";

const ROOT = process.cwd();
const reference = referenceWorkflow(nactiWorkflow(ROOT));
const racna: string[] = JSON.parse(readFileSync(join(ROOT, "src/tests/gates/ci-kontrakt.baseline.json"), "utf8")).racna;
const doktor = klicKontraktuDoktora(readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8"));
const n = nalezyKontraktu({ reference, kontrakt: KONTRAKT_CI, racna, doktor, overovace: OVEROVACE });

describe("kontrakt tajemství a proměnných CI", () => {
  it("měřidlo vidí workflow i kontrakt doktora (jinak by brána mlčela)", () => {
    expect(reference.size, "žádný odkaz secrets./vars. ve .github/workflows").toBeGreaterThan(10);
    expect(doktor.size, "kontrakt aisha-env-doctor nejde přečíst").toBeGreaterThan(100);
  });

  it("⛔ nové jméno ve workflow bez zařazení do KONTRAKT_CI", () => {
    expect(
      n.nezarazene,
      "Tahle jména čte CI, ale kontrakt neví, odkud pocházejí — doktor je nezměří a v repu můžou chybět bez povšimnutí.\n" +
        "Zařaď je do KONTRAKT_CI (scripts/lib/ci-kontrakt.mjs): zdroj { trezor: <klíč doktora> } nebo \"externi\", povinne, ucel.",
    ).toEqual([]);
  });

  it("⛔ ráčna jen ubývá — zařazená nebo nečtená jména z ní odejdou", () => {
    expect(n.zastaraleVRacne, "Odeber je z src/tests/gates/ci-kontrakt.baseline.json").toEqual([]);
  });

  it("⛔ kontrakt nevede položky, které žádné workflow nečte", () => {
    expect(n.mrtve, "Mrtvá položka by v reportu chybu ukazovala tam, kde žádná není").toEqual([]);
  });

  it("⛔ zdroj „trezor“ odkazuje na klíč, který kontrakt doktora ZNÁ (žádná kopie druhu)", () => {
    expect(n.neznamyTrezor, "Klíč musí existovat v CONTRACT scripts/aisha-env-doctor.mjs").toEqual([]);
  });

  it("⛔ ověřovač v kontraktu existuje; položka je v kontraktu jednou", () => {
    expect(n.neznamyOverovac).toEqual([]);
    expect(n.dvojite).toEqual([]);
  });
});
