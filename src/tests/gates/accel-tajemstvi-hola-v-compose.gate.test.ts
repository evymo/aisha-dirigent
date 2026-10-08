/**
 * Brána: tajemství akcelerační vrstvy se v compose interpolují HOLÁ (`${X}`),
 * nikdy `${X:?}` / `${X?}`.
 *
 * `${SECRET:?}` je požadavek na parsování: Coolify parsuje compose i při buildu,
 * klíč proto dostane `is_buildtime=true` → `--build-arg` → zápis do historie
 * obrazu napořád (rohatka build-time-mnozina-vsech-compose). Token Hugging Face
 * (`HF_READ_TOKEN`, v compose vstupu jako `HF_TOKEN: ${HF_READ_TOKEN}`) a interní
 * klíč operátora VB ↔ enginy (`ACCEL_JADRO_API_KEY`) jsou přesně tenhle případ; povinnost za běhu nese
 * pole `x-aisha-povinne-za-behu` (předlet nasazení), ne `:?`.
 *
 * Množina se NEOPISUJE: jsou to klíče kontraktu env-doktora vázané na lane služeb
 * vrstvy (`zaLaneSluzby("accel…")`), jejichž jméno je jménem tajemství — přibude-li
 * vrstvě další tajemství, brána ho uvidí sama.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doktor = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
const JE_TAJEMSTVI = /(TOKEN|SECRET|PASSWORD|API_KEY|_KEY$)/;

/** Klíče kontraktu za lane služeb vrstvy accel, které jsou tajemstvím. */
function tajemstviVrstvy(): string[] {
  return [...doktor.matchAll(/^\s*\["([A-Z0-9_]+)",\s*"[a-z-]+"[^\n]*zaLaneSluzby\("accel[a-z-]*"/gm)]
    .map((m) => m[1])
    .filter((k) => JE_TAJEMSTVI.test(k));
}

/** `${X:?…}` / `${X?…}` pro dané klíče v textu compose. */
export function povinnaTajemstvi(text: string, klice: string[]): string[] {
  return klice.filter((k) => new RegExp(`\\$\\{${k}:?\\?`).test(text));
}

describe("tajemství vrstvy accel nejdou do buildu", () => {
  const klice = tajemstviVrstvy();

  it("univerzum: kontrakt vrstvy tajemství má (HF_READ_TOKEN, ACCEL_JADRO_API_KEY)", () => {
    expect(klice).toEqual(expect.arrayContaining(["HF_READ_TOKEN", "ACCEL_JADRO_API_KEY"]));
  });

  it("žádný compose je neinterpoluje s `:?` / `?`", () => {
    const nalezy: string[] = [];
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
      for (const k of povinnaTajemstvi(readFileSync(join(ROOT, f), "utf8"), klice)) nalezy.push(`${f}: \${${k}:?}`);
    }
    expect(nalezy, "tajemství s `:?` jde do build-time množiny → do historie obrazu; použij holé ${X} a x-aisha-povinne-za-behu").toEqual([]);
  });

  it("mutace: `${HF_READ_TOKEN:?}` i `${ACCEL_JADRO_API_KEY?}` měřidlo chytí, holé `${X}` ne", () => {
    expect(povinnaTajemstvi("HF_TOKEN: ${HF_READ_TOKEN:?chybi}\nK: ${ACCEL_JADRO_API_KEY?}", klice).sort()).toEqual(["ACCEL_JADRO_API_KEY", "HF_READ_TOKEN"]);
    expect(povinnaTajemstvi("HF_TOKEN: ${HF_READ_TOKEN}\nK: ${ACCEL_JADRO_API_KEY}", klice)).toEqual([]);
  });
});
