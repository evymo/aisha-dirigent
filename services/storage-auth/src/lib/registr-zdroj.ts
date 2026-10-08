import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * Stažení balíčku z deklarovaného zdroje (registr balíčků, kam je publikuje CI —
 * původ deklaruje operátor v `ZARIZENI_ZDROJ_PUVOD`).
 *
 * ⛔ TOKEN JEN NA NAKONFIGUROVANÝ PŮVOD. Adresa přichází z DAT INSTANCE; kdyby
 *    se token přikládal ke každé, stačil by jeden překlep nebo cizí zdroj
 *    v deklaraci a token k registru by odešel mimo dům. Přikládá se proto jen
 *    tam, kde `new URL(url).origin` === původ registru z prostředí.
 *
 * ⛔ PŘESMĚROVÁNÍ RUČNĚ. Registr může odkázat na úložiště blobů jinde; tam už
 *    token nepatří. Proto `redirect: 'manual'` a token se na další skok přiloží
 *    jen při STEJNÉM původu — nespoléhá se na to, co s hlavičkou udělá knihovna.
 */
export interface RegistrZdroj {
  /** Původ registru (např. `https://repo.example.cz`), `''` = token nikam. */
  puvod: string;
  /** Token jen pro čtení balíčků; `''` = stahuje se bez něj. */
  token: string;
  /** Strop na celé stažení (včetně přesměrování). */
  limitMs: number;
}

const MAX_SKOKU = 3;

export function vytvorStahovani(r: RegistrZdroj, f: typeof fetch = fetch): (url: string) => Promise<Readable> {
  const puvodRegistru = r.puvod ? new URL(r.puvod).origin : '';
  return async (url: string) => {
    // ⛔ ZAČÍNÁ SE JEN NA REGISTRU (revize aisha-team 2026-09-24). Adresa je z dat
    //    instance; kdyby smělo jít o jakékoli https, deklarace by poslala službu
    //    na vnitřní adresu (metadata, localhost, privátní rozsah) — naslepo, ale
    //    z NAŠÍ sítě. Přesměrování z registru jinam (úložiště blobů) projde, bez tokenu.
    if (!puvodRegistru) throw new Error('původ registru (ZARIZENI_ZDROJ_PUVOD) není nastavený — zdroj nejde ověřit');
    if (new URL(url).origin !== puvodRegistru) throw new Error(`zdroj není na registru ${puvodRegistru}: ${new URL(url).origin}`);
    const signal = AbortSignal.timeout(r.limitMs);
    let adresa = url;
    for (let skok = 0; skok <= MAX_SKOKU; skok++) {
      const u = new URL(adresa);
      if (u.protocol !== 'https:') throw new Error(`zdroj není https: ${u.origin}`);
      const hlavicky: Record<string, string> = {};
      if (r.token && puvodRegistru && u.origin === puvodRegistru) hlavicky.Authorization = `token ${r.token}`;
      const odp = await f(u, { headers: hlavicky, redirect: 'manual', signal });
      if (odp.status >= 300 && odp.status < 400) {
        const dal = odp.headers.get('location');
        if (!dal) throw new Error(`zdroj ${u.origin} přesměroval bez adresy`);
        adresa = new URL(dal, u).toString();
        continue;
      }
      // Adresu do chyby jen jako původ + cestu: dotaz může nést cokoli.
      if (!odp.ok || !odp.body) throw new Error(`zdroj ${u.origin}${u.pathname} vrátil ${odp.status}`);
      return Readable.fromWeb(odp.body as unknown as WebReadableStream<Uint8Array>);
    }
    throw new Error(`zdroj přesměroval víc než ${MAX_SKOKU}×`);
  };
}
