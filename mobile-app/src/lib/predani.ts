/**
 * PŘEDÁNÍ VE DVOU KROCÍCH — pravidla listu předání (bod 3 vizuálu, 2026-09-29).
 *
 * Tvar z makety (`driver-handover.jsx`, `Handover`): 1 Kontrola → 2 Podpis → „Předáno".
 * Majitel 19. 8.: „2 kroky, razítko Předáno + odměna" převzít; jediná akce řidiče je
 * „Potvrdit předání"; podpis a jméno přebírajícího jsou povinné a tlačítko říká PROČ
 * nejde stisknout.
 *
 * ⛔ Z MAKETY VĚDOMĚ NENÍ (nekreslit bez zdroje dat, majitel 19. 8.): úprava hmotnosti
 *    se stepperem (rozdíl je nález, ne editace), PIN zákazníka (žádná distribuce PINů),
 *    koeficient K a „Kč k prémii", „Vrátit předání" (vratné okno = zdržený outbox,
 *    zatím nepostavený — tlačítko bez něj by lhalo).
 *
 * Čisté funkce: obrazovka i test měří totéž pravidlo, ne vykreslený strom.
 */

/** Co ještě chybí k potvrzení — `null` = nic, tlačítko smí. */
export type ChybiKPotvrzeni = "podpis" | "jmeno" | "obe" | null;

/** Jméno kratší než dva znaky není jméno („J", mezera) — maketa chce víc než dva. */
const MIN_JMENO = 2;

/**
 * ⭐ `vyzadovat` rozhoduje VOLAJÍCÍ podle toho, čí krok je. Řidič u rampy potvrzuje
 * vlastní předání a bez podpisu a jména to není předání. Dispečer, který přes
 * `?step=` odbavuje CIZÍ krok (třeba po telefonu), podpis nemá odkud vzít — a tahle
 * cesta existovala i před listem (`complete_workflow_step` bez evidence).
 */
export function chybiKPotvrzeni(p: { podpis: string | null; jmeno: string; vyzadovat: boolean }): ChybiKPotvrzeni {
  if (!p.vyzadovat) return null;
  const bezPodpisu = !p.podpis;
  const bezJmena = p.jmeno.trim().length < MIN_JMENO;
  if (bezPodpisu && bezJmena) return "obe";
  if (bezPodpisu) return "podpis";
  if (bezJmena) return "jmeno";
  return null;
}

/** Minimální tvar kroku ve frontě, který potřebuje „Další jízda". */
export interface KrokFronty {
  step_id: string;
  status: string;
}

/**
 * Další zastávka po té, která se právě předala — PRVNÍ čekající v pořadí fronty.
 *
 * ⛔ Právě předaný krok se vynechává podle id: fronta se po odeslání obnovuje až
 *    dotazem, takže v ní chvíli ještě stojí jako čekající a „Další jízda" by
 *    ukázala tutéž dodávku.
 * ⭐ Pořadí se NEŘADÍ — je producentovo a samo je informace (viz `partitionTape`).
 */
export function dalsiZastavka<T extends KrokFronty>(kroky: readonly T[], hotovyId: string): T | null {
  return kroky.find((k) => k.step_id !== hotovyId && k.status !== "completed" && k.status !== "failed") ?? null;
}

/** Místní čas potvrzení jako „HH:MM" — na razítku stojí čas stisku, ne odeslání. */
export function casNaRazitku(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
