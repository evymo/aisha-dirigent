/**
 * NÁJEM ADRESY — přihlášení drží dveře otevřené, odhlášení je zavře.
 *
 * Rozhodnutí majitele 2026-09-01: „přihlášení whitelistuje uživatelovu IP na
 * edge — dokud je přihlášen, nebo dokud ho neodhlásíš z KC."
 *
 * ⛔ PROČ TO NEJDE ZAPSAT PŘÍMO. Mapu otevřených adres VLASTNÍ `svc-knock`:
 * on ji píše při zaťukání a on z ní dává verdikt dveřím na edge. Druhý
 * zapisovatel by byl druhý domov téže pravdy — rozešly by se a rozdíl by
 * nikdo neviděl. Brána proto ŽÁDÁ, nezapisuje.
 *
 * ⛔ PROČ SE ADRESA NEPOSÍLÁ HODNOTOU. Kdyby brána poslala „prodluž IP X",
 * musel by jí `svc-knock` věřit — a kdokoli uvnitř sítě by pak mohl otevřít
 * libovolnou adresu. Posílá se proto PŮVODNÍ `x-forwarded-for` a `svc-knock`
 * si klienta odvodí TOUŽ chůzí zprava jako u verdiktu. Jeden výpočet, jedno
 * místo, žádná důvěra v hodnotu.
 *
 * ⭐ KLOUZAVÉ OKNO, NE OBNOVA NA POSLEDNÍ CHVÍLI. Brána je ZA dveřmi: až nájem
 * vyprší, žádný další požadavek se k ní nedostane a nebude to mít kdo
 * prodloužit. Proto se prodlužuje průběžně při provozu, ne až těsně před
 * koncem.
 *
 * ⭐ ŠKRCENO. Volat to při každém požadavku by znamenalo skok navíc na každý
 * dotaz. Stačí jednou za okno — nájem se tím drží stejně.
 */
import { request as httpRequest } from 'node:http';

/** Kdy jsme naposledy prodlužovali pro danou hlavičku (klíč = její obsah). */
const naposledy = new Map<string, number>();

/** Jak často se smí prodlužovat pro tutéž adresu. Nižší = víc skoků, ne víc bezpečí. */
const SKRCENI_MS = 60_000;

/** Strop mapy — jinak by rostla s počtem adres donekonečna. */
const STROP_ZAZNAMU = 10_000;

function projdeSkrcenim(klic: string, ted: number): boolean {
  const posledni = naposledy.get(klic);
  if (posledni !== undefined && ted - posledni < SKRCENI_MS) return false;
  if (naposledy.size >= STROP_ZAZNAMU) naposledy.clear();
  naposledy.set(klic, ted);
  return true;
}

/**
 * Pošle `svc-knock` žádost. Vždy fire-and-forget: nájem je vedlejší účinek
 * ověření, ne jeho podmínka. Kdyby to shodilo požadavek, přihlášení by
 * přestalo fungovat pokaždé, když je `svc-knock` chvíli mimo.
 */
function posli(zaklad: string, cesta: string, xff: string | undefined): void {
  let u: URL;
  try { u = new URL(cesta, zaklad); } catch { return; }
  const req = httpRequest(
    {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      timeout: 2_000,
      headers: xff ? { 'x-forwarded-for': xff } : {},
    },
    (res) => { res.resume(); },
  );
  req.on('error', () => { /* mimo = nájem doběhne sám; nikoho to nesmí zastavit */ });
  req.on('timeout', () => req.destroy());
  req.end();
}

/** Prodlouží nájem adresy, ze které přišel ověřený požadavek. Škrceno. */
export function prodluzNajem(knockUrl: string | undefined, xff: string | undefined): void {
  if (!knockUrl || !xff) return;
  if (!projdeSkrcenim(xff, Date.now())) return;
  posli(knockUrl, '/dvere/prodluz', xff);
}

/** Zavře adresu okamžitě — odhlášení nebo odvolání tokenu. Neškrtí se. */
export function zavriNajem(knockUrl: string | undefined, xff: string | undefined): void {
  if (!knockUrl || !xff) return;
  naposledy.delete(xff);
  posli(knockUrl, '/dvere/zavri', xff);
}
