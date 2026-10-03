// =============================================================================
// seed-platno.mjs — JEDINÝ výklad toho, jak vypadá `01_web.sql`
// =============================================================================
// ⛔ PROČ SDÍLENÝ MODUL. Tvar seedu potřebují DVA nástroje: detektor rozejití
// (`platno-vs-seed.mjs`) a export z databáze zpět (`platno-do-seedu.mjs`).
// Kdyby si ho každý vykládal po svém, rozešly by se — a to je přesně vada,
// kterou tyhle nástroje mají hlídat.
//
// TVAR SEEDU, jak byl 2026-09-01 naměřen (ne odhadnut):
//
//   INSERT INTO public.web_pages (slug, title_key, description_key,
//     canvas_data, canvas_html, canvas_css, status, is_active,
//     branding_profile_id, page_settings)
//   VALUES ('<slug>', '<title_key>', '<desc|NULL>',
//     $wp$…canvas_data…$wp$::jsonb,
//     $wp$…canvas_html…$wp$,
//     <BUĎ $wp$…css…$wp$  NEBO  (SELECT w.canvas_css FROM … slug='index' …)>,
//     …)
//
// ⛔ DVA TVARY, NE JEDEN. `canvas_css` nesou doslova jen `index`, `nav`
// a `footer`; ostatní stránky ho berou ODKAZEM na `index`. Parser, který
// slepě čekal tři dolarové bloky, zahodil devět stránek z dvanácti.
//
// ⛔ DOLAROVÁ ZNAČKA NENÍ VŽDY `$wp$`. Generátor ji prodlužuje, když ji obsah
// sám obsahuje. Čte se ta, kterou blok skutečně otevřel.
// =============================================================================

/** Najde bloky dolarových uvozovek v jednom INSERTu; vrací pozice i obsah. */
function dolaroveBloky(text, kolik) {
  const out = [];
  let od = 0;
  while (out.length < kolik) {
    const m = /\$(wpx*)\$/.exec(text.slice(od));
    if (!m) break;
    const tag = `$${m[1]}$`;
    const zacatek = od + m.index + tag.length;
    const konec = text.indexOf(tag, zacatek);
    if (konec < 0) break;
    out.push({ tag, zacatek, konec, obsah: text.slice(zacatek, konec) });
    od = konec + tag.length;
  }
  return out;
}

/**
 * Rozebere seed na stránky.
 * @returns Map<slug, {data, html, css, cssJeOdkaz, blokOd, blokDo, bloky}>
 *   `blokOd`/`blokDo` jsou pozice INSERTu v CELÉM textu — export podle nich
 *   přepisuje na místě, aby zůstaly zachovány komentáře i vše ostatní.
 */
export function rozeberSeed(text) {
  const out = new Map();
  const vzor = /INSERT INTO public\.web_pages \(slug/g;
  const zacatky = [];
  let m;
  while ((m = vzor.exec(text)) !== null) zacatky.push(m.index);

  const surove = [];
  for (let i = 0; i < zacatky.length; i += 1) {
    const od = zacatky[i];
    const do_ = i + 1 < zacatky.length ? zacatky[i + 1] : text.length;
    const blok = text.slice(od, do_);
    const slug = /VALUES \('([a-z0-9-]+)'/.exec(blok)?.[1];
    if (!slug) continue;
    const bloky = dolaroveBloky(blok, 3);
    if (bloky.length < 2) continue;
    surove.push({
      blokDo: do_,
      blokOd: od,
      bloky: bloky.map((b) => ({ ...b, zacatek: b.zacatek + od, konec: b.konec + od })),
      css: bloky.length >= 3 ? bloky[2].obsah : null,
      cssJeOdkaz: bloky.length < 3,
      data: bloky[0].obsah,
      html: bloky[1].obsah,
      slug,
    });
  }
  const spolecneCss = surove.find((r) => r.slug === "index")?.css ?? "";
  for (const r of surove) out.set(r.slug, { ...r, css: r.css ?? spolecneCss });
  return out;
}

/**
 * Kanonické porovnání JSON — `jsonb` klíče PŘEROVNÁVÁ, takže doslovné
 * porovnání textu hlásí rozdíl i u nedotčených stránek (naměřeno: stejná
 * délka, jiné pořadí). Klíče se řadí rekurzivně.
 */
export function stejnyJson(a, b) {
  const kanonicky = (v) => {
    if (Array.isArray(v)) return v.map(kanonicky);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, kanonicky(v[k])]),
      );
    }
    return v;
  };
  try {
    return JSON.stringify(kanonicky(JSON.parse(a))) === JSON.stringify(kanonicky(JSON.parse(b)));
  } catch {
    return a === b; // nerozparsovatelné se porovná doslova, ne prohlásí za shodné
  }
}
