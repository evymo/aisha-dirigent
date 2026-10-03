/**
 * Vstup do servisu hlídače musí technik v terénu NAJÍT a STIHNOUT.
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA (2026-09-25). Jediná cesta z kiosku ven je během
 * odpočtu po restartu ťuknout 7× na nadpis a zadat PIN. S odpočtem 5 s a bez
 * jakékoli nápovědy se do servisu nedostal ani majitel. Restart navíc často jde
 * jen vynuceně (boční + ztlumení ~10 s), protože v kiosku podržení bočního
 * tlačítka nic neudělá. Zkrácení odpočtu nebo ztráta nápovědy by nic
 * nerozbilo v testech, jen by tablet v terénu opět nešel otevřít.
 *
 * ⭐ Počet ťuknutí nese nápověda z konstanty TUKNUTI, ne opsané číslo, aby se
 *    text nerozešel s tím, co DomovActivity opravdu počítá.
 * ⭐ Nápověda neprozradí PIN: je to jen text z prostředků, PIN do ní nevstupuje.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const KOREN = path.resolve(__dirname, "..", "..", "..");
const HLIDAC = path.join(KOREN, "apps/hlidac/app/src/main");
const DOMOV = readFileSync(path.join(HLIDAC, "java/platforma/hlidac/DomovActivity.java"), "utf8");
const JAZYKY = ["values", "values-cs"] as const;
const retezec = (slozka: string, jmeno: string) => {
  const xml = readFileSync(path.join(HLIDAC, "res", slozka, "strings.xml"), "utf8");
  return new RegExp(`<string name="${jmeno}">([^<]*)</string>`).exec(xml)?.[1];
};

describe("servis hlídače je najitelný", () => {
  it("odpočet po restartu dává technikovi aspoň 10 s", () => {
    const m = /private static final int ODPOCET_S = (\d+);/.exec(DOMOV);
    expect(m, "ODPOCET_S v DomovActivity").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(10);
  });

  it.each(JAZYKY)("%s: nápověda existuje a nese počet ťuknutí jako proměnnou", (slozka) => {
    const text = retezec(slozka, "servis_napoveda");
    expect(text, `${slozka}/strings.xml servis_napoveda`).toBeTruthy();
    expect(text!.match(/%\d\$d/g), "právě jedna číselná proměnná").toEqual(["%1$d"]);
    expect(text!.replace(/%\d\$d/g, ""), "žádné opsané číslo místo proměnné").not.toMatch(/\d/);
  });

  it("odpočet nápovědu ukazuje a plní ji konstantou TUKNUTI", () => {
    const odpocet = DOMOV.slice(DOMOV.indexOf("private void odpocet("), DOMOV.indexOf("private void spustKiosk("));
    expect(odpocet).toMatch(/getString\(R\.string\.servis_napoveda,\s*TUKNUTI\)/);
    expect(DOMOV).toMatch(/if \(\+\+tuknuti < TUKNUTI/);
  });
});
