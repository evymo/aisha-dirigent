/**
 * Práce řidiče se nesmí ztratit jen proto, že server řekl ne.
 *
 * Věty, které se tu dokládají, nejsou o kódu — jsou o tom, co se stane
 * člověku v lomu, který právě vyplnil předání a stiskl potvrdit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFailure, RpcFailure } from "@/services/offline";
import { zachranaPrace } from "@/lib/zachranaPrace";

// Týž postup jako v `offlineQueue.test.ts`: `services/offline` táhne `config/api`
// a přes něj `expo-linking`, které v testu nemá manifest. Mock uřízne řetěz
// u zdroje — a nic z toho, co se tu měří, na něm nestojí.
jest.mock("@/config/api", () => ({ api: { rpc: jest.fn() } }));
jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn(), safeInfo: jest.fn() }));

/** Chyba tak, jak ji vyrobí API vrstva — se statusem, který nese příčinu. */
const selhani = (status?: number) => {
  const e = new RpcFailure("selhalo");
  if (status !== undefined) (e as { status?: number }).status = status;
  return e;
};

describe("záchrana rozdělané práce", () => {
  describe("co se uloží a co ne", () => {
    it("403 (edge nás odmítá) — práci ULOŽÍ a nabídne zaklepání", () => {
      const z = zachranaPrace(classifyFailure(selhani(403)));
      expect(z.ulozit).toBe(true);
      expect(z.nabidnoutZaklepani).toBe(true);
    });

    it("401 (neplatná identita) — táž reakce jako 403", () => {
      const z = zachranaPrace(classifyFailure(selhani(401)));
      expect(z.ulozit).toBe(true);
      expect(z.nabidnoutZaklepani).toBe(true);
    });

    it("bez statusu (odpověď nedorazila) — ULOŽÍ, ale zaklepání NENABÍZÍ", () => {
      // Tohle je řidič v tunelu. Kdyby se mu tu nabídl kód, naučí se ho
      // zadávat rutinně — a break-glass přestane být break-glass.
      const z = zachranaPrace(classifyFailure(selhani(undefined)));
      expect(z.ulozit).toBe(true);
      expect(z.nabidnoutZaklepani).toBe(false);
    });

    it.each([408, 429, 500, 503])("%i (přechodné) — ULOŽÍ, bez zaklepání", (status) => {
      const z = zachranaPrace(classifyFailure(selhani(status)));
      expect(z.ulozit).toBe(true);
      expect(z.nabidnoutZaklepani).toBe(false);
    });

    it.each([400, 409, 422])("%i (server rozuměl a odmítl DATA) — NEUKLÁDÁ", (status) => {
      // Uložit by znamenalo dostat totéž odmítnutí znovu, jen později — a mezitím
      // tvrdit člověku, že je jeho práce v pořádku uložená.
      const z = zachranaPrace(classifyFailure(selhani(status)));
      expect(z.ulozit).toBe(false);
      expect(z.nabidnoutZaklepani).toBe(false);
    });
  });

  describe("zaklepání se nabízí VÝHRADNĚ u odmítnuté identity", () => {
    it("žádný jiný druh selhání ho nerozsvítí", () => {
      const jine = ["unreachable", "transient", "rejected"] as const;
      const svitici = jine.filter((k) => zachranaPrace(k).nabidnoutZaklepani);
      // Prázdné pole v hlášce rovnou ukáže, KTERÝ druh navíc svítí.
      expect(svitici).toEqual([]);
      expect(zachranaPrace("denied").nabidnoutZaklepani).toBe(true);
    });
  });

  describe("pravidlo má volajícího", () => {
    /**
     * ⛔ Dnešní poučení (knock.ts): modul, který má testy a nikdo ho nevolá,
     * není ověřený kód — je to ověřená knihovna. Tenhle test hlídá, že
     * obrazovka řidiče pravidlo opravdu POUŽÍVÁ; jinak by šlo celé zelené
     * a práce by se dál ztrácela.
     */
    const kroky = readFileSync(
      join(__dirname, "../app/kroky.tsx"),
      "utf8",
    );

    it("kroky.tsx pravidlo importuje a volá", () => {
      expect(kroky).toMatch(/from\s+["']@\/lib\/zachranaPrace["']/);
      expect(kroky).toMatch(/zachranaPrace\(/);
    });

    it("kroky.tsx už nemá HOLÝ catch, který příčinu zahodí", () => {
      // `catch {` bez vazby na chybu je přesně tvar, kterým se práce ztrácela.
      // Dva SMĚJÍ zůstat a oba jsou zdokumentované:
      //  · pád uploadu fotky odečet neruší (foto je doklad navíc, ne podmínka),
      //  · selhání zápisu do fronty se hlásí jako neúspěch, ne jako „uloženo".
      const holy = kroky.match(/\}\s*catch\s*\{/g) ?? [];
      expect(holy.length).toBeLessThanOrEqual(2);
    });
  });
});
