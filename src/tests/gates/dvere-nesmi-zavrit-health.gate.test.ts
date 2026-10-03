/**
 * BRÁNA: dveře na edge nesmí zavřít cestu, na které visí healthcheck.
 *
 * ⛔ NAMĚŘENO 2026-09-01 V PROVOZU. `handle /__edge_health` stálo v Caddyfile
 * VÝŠ než dveře, a přesto ho zavřely: Caddy neřadí direktivy podle pořadí
 * v textu, ale podle vlastního pořadníku, a `forward_auth` v něm běží PŘED
 * `handle`. Následek byl řetězový a shodil VEŘEJNOU PLOCHU:
 *
 *   health zavřen → kontejner `unhealthy` → Traefik „no available server"
 *   → 503 na všem → Coolify restart → nový kontejner → a znovu.
 *
 * Komentář v compose o tom, že health zůstává před dveřmi, byl napsaný
 * SPRÁVNĚ — nesplnila ho implementace. Proto tahle brána měří VLASTNOST
 * (cesta je vyjmutá matcherem, který na pořadníku nezávisí), ne pořadí řádků.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(
  join(__dirname, '..', '..', '..', 'docker-compose.coolify-prebuilt.yml'),
  'utf-8',
);
/** Měří se KÓD, ne próza o něm — komentáře obsahují tatáž slova. */
const kod = compose.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('brána: dveře nesmí zavřít health', () => {
  it('sonda má co měřit — dveře v compose existují', () => {
    expect(kod).toMatch(/forward_auth/);
  });

  it('dveře NEMOHOU zavřít health — ať už výjimkou, nebo odděleným listenerem', () => {
    // ⭐ MĚŘÍ SE VLASTNOST, NE MECHANISMUS. Do 2026-09-02 tu stálo, že cesta
    // musí být vyjmuta MATCHEREM (`not path /__edge_health` v témže řádku jako
    // `forward_auth`). Jenže to je JEDEN ze dvou způsobů, jak tu vlastnost
    // splnit — a ten horší: každá výjimka ve dveřích je díra, kterou někdo
    // rozšíří.
    //
    // Druhý způsob je lepší: health VŮBEC NENÍ na veřejném listeneru. Sedí na
    // neveřejné `:8081`, která se nepublikuje ani nevystavuje, takže ji dveře
    // nemají jak zavřít — a veřejná `:80` pak nepotřebuje žádnou výjimku.
    //
    // ⛔ Chráněný incident zůstává TÝŽ (2026-09-01): health zavřený dveřmi →
    // kontejner `unhealthy` → Traefik „no available server" → 503 na celou
    // plochu → restart → a znovu. Brána ho hlídá dál, jen připouští obě cesty.
    const radekDveri = kod.split('\n').find((l) => l.includes('forward_auth'));
    expect(radekDveri).toBeDefined();

    const vyjimkaMatcherem = /not path \/__edge_health/.test(radekDveri ?? '');
    // Oddělený listener: health je deklarovaný v JINÉM bloku než ten, který
    // dveře hlídají. Doložení = existuje `:<port> {` s health uvnitř a ten port
    // NENÍ 80.
    const oddelenyListener =
      /:(?!80\b)\d{2,5}\s*\{[\s\S]{0,400}?__edge_health/.test(kod) &&
      !/:80\s*\{[\s\S]{0,600}?handle \/__edge_health/.test(kod);

    expect(
      vyjimkaMatcherem || oddelenyListener,
      'Health je na veřejné :80 a dveře ho nevyjímají — kontejner si zabije ' +
        'vlastní healthcheck a stáhne s sebou celou plochu (naměřeno 2026-09-01).',
    ).toBe(true);
  });

  it('dveře se nezavřou bez toho, kdo dá verdikt', () => {
    // Prázdný upstream = nikdo nehlídá; zavřít by znamenalo zamknout všechny.
    expect(kod).toMatch(/KNOCK_UPSTREAM[^\n]*\n[^\n]*NEZAVÍRÁ SE|-z .\$\{KNOCK_UPSTREAM/);
  });
});
