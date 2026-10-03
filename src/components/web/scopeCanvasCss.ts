/**
 * Scope a seeded web page's canvas CSS under `.gjs-page-content` so it never
 * collides with the surrounding app (Tailwind/shadcn).
 *
 * Canvas-root selectors (`:root` / `html` / `body`) map to the page wrapper
 * ITSELF, not a descendant. This lets a template author its design tokens and
 * page background on `:root` — the portable form that also matches the GrapesJS
 * editor — and have them land on `.gjs-page-content`. CSS custom properties then
 * cascade to the page's runtime blocks (product-catalog, knowledge-preview, …)
 * by plain inheritance — no `!important`, no JS — so a template's own palette
 * themes its dynamic blocks coherently with its static chrome.
 *
 * Without this mapping the previous scoper turned `:root{…}` into
 * `.gjs-page-content :root` (matches nothing — the only `:root` is the ancestor
 * `<html>`), silently dropping template-root styles at runtime.
 */

/** Kořen plátna: tyto selektory míří na obal SAMOTNÝ, ne na potomka. */
const KORENOVY_SELEKTOR = /^(:root|html|body)$/i;

/**
 * At-pravidla, jejichž tělo je zase SEZNAM BĚŽNÝCH PRAVIDEL — obsah se tedy
 * oboruje stejně jako na nejvyšší úrovni.
 *
 * Ostatní at-pravidla s blokem (`@keyframes`, `@font-face`, `@page`,
 * `@property`, `@counter-style`) mají tělo JINÉHO druhu: klíčové snímky nebo
 * holé deklarace. Tam by scopování jen škodilo — `.gjs-page-content to { … }`
 * uvnitř `@keyframes` není platný snímek a animace zmizí.
 */
const AT_PRAVIDLA_SE_SEZNAMEM = /^@(media|supports|container|layer|scope)\b/i;

/**
 * Scope a page's canvas CSS under `.gjs-page-content`.
 *
 * ⛔ PRŮCHOD ZÁVORKAMI, NE REGULÁRNÍ VÝRAZ (naměřeno 2026-09-02 na produkci).
 *
 * Dřívější vzor `/(^|\})\s*([^@{}]+?)\s*\{/g` se kotvil jen na začátku vstupu
 * a za `}`. Prvnímu pravidlu uvnitř `@media (…) {` ale předchází `{`, takže
 * PRVNÍ pravidlo každého at-bloku zůstalo neoborované, zatímco všechna další
 * (jimž předchází `}` po sousedovi) oborovaná byla.
 *
 * Samo o sobě by to nevadilo — neoborovaný selektor prvek pořád trefí.
 * Škodí až rozdíl SPECIFICITY: základní pravidlo je po oborování (0,2,0),
 * přepis v médiu zůstal (0,1,0), takže kaskáda dá přednost základnímu a
 * responzivní přepis MLČKY NEPLATÍ.
 *
 * Doloženo: `.hero__inner` mělo na šířce 375 px pořád `grid-template-columns:
 * 87px 192px` místo `1fr` — dva sloupce namačkané do telefonu; obrázek vyšel
 * 87 px široký. Vada byla tichá, protože CSS je syntakticky v pořádku.
 *
 * Kotvit i za `{` by první pravidlo spravilo, ale rozbilo `@keyframes`
 * (viz AT_PRAVIDLA_SE_SEZNAMEM). Rozlišit „seznam pravidel" od „deklarace"
 * a „klíčové snímky" vzor neumí — potřebuje vědět, uvnitř ČEHO je. Proto
 * průchod závorkami.
 */
export function scopeCanvasCss(canvasCss: string | null | undefined): string {
  if (!canvasCss) return "";

  // ⛔ KOMENTÁŘE SE STRHÁVAJÍ Z CELÉHO CSS, NE ZE SELEKTORU
  // (naměřeno 2026-09-01 na produkci, DVĚ kola).
  //
  // První pokus čistil až zachycený selektor. Nestačilo to: komentář běžně
  // obsahuje složenou závorku („turned `:root{…}` into") a průchod by ji
  // četl jako strukturu CSS.
  //
  // Odstranění PŘED zpracováním problém ruší u kořene: co v CSS není, nemůže
  // průchod zmást. Komentáře jsou pro autora seedu, ne pro prohlížeč — jejich
  // ztráta ve výstupu nic nestojí a ušetří ~25 kB v každé stránce.
  const bezKomentaru = canvasCss.replace(/\/\*[\s\S]*?\*\//g, "");

  return oborujSeznamPravidel(bezKomentaru);
}

/** Oboruje seznam pravidel (nejvyšší úroveň i tělo `@media` a spol.). */
function oborujSeznamPravidel(css: string): string {
  let vysledek = "";
  let i = 0;

  while (i < css.length) {
    const otevreno = dalsiZnak(css, i, "{;");

    // Zbytek bez závorky i středníku: holý text, projde beze změny.
    if (otevreno === -1) return vysledek + css.slice(i);

    // At-pravidlo bez bloku (`@import url(…);`, `@layer a, b;`) — opsat.
    if (css[otevreno] === ";") {
      vysledek += css.slice(i, otevreno + 1);
      i = otevreno + 1;
      continue;
    }

    const preambule = css.slice(i, otevreno);
    const konec = konecBloku(css, otevreno);
    const telo = konec === -1 ? css.slice(otevreno + 1) : css.slice(otevreno + 1, konec);
    const hlavicka = preambule.trim();
    const odsazeni = preambule.slice(0, preambule.length - preambule.trimStart().length);

    if (hlavicka.startsWith("@")) {
      const uvnitr = AT_PRAVIDLA_SE_SEZNAMEM.test(hlavicka) ? oborujSeznamPravidel(telo) : telo;
      vysledek += `${preambule}{${uvnitr}}`;
    } else {
      vysledek += `${odsazeni}${oborujSelektor(hlavicka)} {${telo}}`;
    }

    // Neuzavřený blok: zpracovali jsme zbytek, další už nic není.
    if (konec === -1) return vysledek;
    i = konec + 1;
  }

  return vysledek;
}

/** `.a, :root, body` → `.gjs-page-content .a, .gjs-page-content, .gjs-page-content` */
function oborujSelektor(selektor: string): string {
  return selektor
    .split(",")
    .map((cast) => cast.trim())
    .filter(Boolean)
    .map((sel) => (KORENOVY_SELEKTOR.test(sel) ? ".gjs-page-content" : `.gjs-page-content ${sel}`))
    .join(", ");
}

/**
 * První výskyt některého ze `znaky` od indexu `od`, MIMO řetězcové literály.
 * Uvozovky se přeskakují, aby `content: "}"` neukončil blok.
 */
function dalsiZnak(css: string, od: number, znaky: string): number {
  let uvozovka: string | null = null;

  for (let i = od; i < css.length; i++) {
    const z = css[i];

    if (uvozovka) {
      if (z === "\\") i++;
      else if (z === uvozovka) uvozovka = null;
      continue;
    }
    if (z === '"' || z === "'") {
      uvozovka = z;
      continue;
    }
    if (znaky.includes(z)) return i;
  }

  return -1;
}

/** Index `}` uzavírajícího blok otevřený na `otevreno`, nebo -1 při nerovnováze. */
function konecBloku(css: string, otevreno: number): number {
  let hloubka = 0;

  for (let i = otevreno; i < css.length; i++) {
    const z = css[i];

    // Řetězcový literál přeskočit vcelku, ať `content: "}"` blok neukončí.
    if (z === '"' || z === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== z) {
        if (css[j] === "\\") j++;
        j++;
      }
      i = j;
      continue;
    }
    if (z === "{") hloubka++;
    else if (z === "}" && --hloubka === 0) return i;
  }

  return -1;
}
