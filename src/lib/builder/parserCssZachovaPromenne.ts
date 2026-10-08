/**
 * Parser CSS pro editor plátna, který NEZTRÁCÍ zkratky s proměnnými.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (na instanci, živý web): výchozí parser GrapesJS 0.22
 * (BrowserParserCss) čte deklarace pravidla po DÍLČÍCH vlastnostech
 * (`style[i]` + `getPropertyValue`). Zkratka, která obsahuje `var()` —
 * `background: linear-gradient(… var(--x) …)`, `padding: var(--space-6)`,
 * `gap: var(--g)` … — má v CSSOM všechny dílčí vlastnosti PRÁZDNÉ (hodnota
 * čeká na dosazení proměnné; ověřeno v Chrome), a tak ji parser zahodil.
 * Dokud autor nesáhl na styly, editor ukládal původní CSS; první změna stylu
 * uložila CSS celé stránky v podobě po parseru: z úvodní stránky instance zmizelo
 * 40 ze 40 takových deklarací (modré pozadí hero, karty, patička, mezery).
 *
 * Oprava: stejný průchod jako výchozí parser (selektory, at-pravidla, stavy),
 * jen deklarace se berou ze serializace pravidla (`style.cssText`), kterou
 * prohlížeč pro zkratku s proměnnou vrací CELOU. Ostatní deklarace vrací
 * prohlížeč tak jako dosud (tytéž hodnoty, jen případně jako zkratka).
 *
 * Výstup má tvar, který GrapesJS čeká od `parser.parserCss` (CssRuleJSON[]).
 * Logika průchodu převzata z grapesjs/src/parser/model/BrowserParserCss.ts
 * (BSD-3-Clause), změněna je jen `parseStyle`.
 */

type Uzel = Record<string, unknown> & { selectors: string[]; style: Record<string, string> };

const TYPY = {
  STYLE_RULE: 1,
  MEDIA_RULE: 4,
  FONT_FACE_RULE: 5,
  PAGE_RULE: 6,
  KEYFRAMES_RULE: 7,
  KEYFRAME_RULE: 8,
  COUNTER_STYLE_RULE: 11,
  SUPPORTS_RULE: 12,
  DOCUMENT_RULE: 13,
  FONT_FEATURE_VALUES_RULE: 14,
  VIEWPORT_RULE: 15,
} as const;

const AT_PRAVIDLA: Record<number, string> = {
  [TYPY.MEDIA_RULE]: "media",
  [TYPY.FONT_FACE_RULE]: "font-face",
  [TYPY.PAGE_RULE]: "page",
  [TYPY.KEYFRAMES_RULE]: "keyframes",
  [TYPY.COUNTER_STYLE_RULE]: "counter-style",
  [TYPY.SUPPORTS_RULE]: "supports",
  [TYPY.DOCUMENT_RULE]: "document",
  [TYPY.FONT_FEATURE_VALUES_RULE]: "font-feature-values",
  [TYPY.VIEWPORT_RULE]: "viewport",
};
const AT_KLICE = Object.keys(AT_PRAVIDLA);
const SAMOSTATNA_AT: number[] = [TYPY.FONT_FACE_RULE, TYPY.PAGE_RULE, TYPY.COUNTER_STYLE_RULE, TYPY.VIEWPORT_RULE];
const VNORITELNA_AT = AT_KLICE.filter((k) => !SAMOSTATNA_AT.includes(Number(k)))
  .map((k) => AT_PRAVIDLA[Number(k)])
  .concat(["container", "layer"]);
const SAMOSTATNA_AT_JMENA = SAMOSTATNA_AT.map((n) => AT_PRAVIDLA[n]);

/**
 * Deklarace z textu bloku (`prop: hodnota; …`) — rozdělí jen na středníku
 * MIMO závorky a uvozovky (`url(data:…;base64,…)` středník obsahuje).
 * `!important` zůstane součástí hodnoty, jak to dělá GrapesJS.
 */
export function deklaraceZCssText(cssText: string): Record<string, string> {
  const vysledek: Record<string, string> = {};
  let hloubka = 0;
  let uvozovka: string | null = null;
  let zacatek = 0;
  const zpracuj = (kus: string) => {
    const dvojtecka = kus.indexOf(":");
    if (dvojtecka < 0) return;
    const vlastnost = kus.slice(0, dvojtecka).trim();
    const hodnota = kus.slice(dvojtecka + 1).trim().replace(/\s*!\s*important$/i, " !important");
    if (vlastnost && hodnota) vysledek[vlastnost] = hodnota;
  };
  for (let i = 0; i < cssText.length; i++) {
    const z = cssText[i];
    if (uvozovka) {
      if (z === "\\") i++;
      else if (z === uvozovka) uvozovka = null;
    } else if (z === '"' || z === "'") uvozovka = z;
    else if (z === "(") hloubka++;
    else if (z === ")") hloubka = Math.max(0, hloubka - 1);
    else if (z === ";" && hloubka === 0) {
      zpracuj(cssText.slice(zacatek, i));
      zacatek = i + 1;
    }
  }
  zpracuj(cssText.slice(zacatek));
  return vysledek;
}

function parseStyle(pravidlo: CSSRule): Record<string, string> {
  const styl = (pravidlo as CSSStyleRule).style;
  return styl ? deklaraceZCssText(styl.cssText) : {};
}

const JMENO = /^[\w-]+$/;
const ZNAK_JMENA = /[\w-]/;

/** Stavy za základem selektoru (`:hover`, `::before`, `:not(…)`) — tvar jako v GrapesJS. */
function jsouStavy(zbytek: string): boolean {
  let i = 0;
  while (i < zbytek.length) {
    if (zbytek[i] !== ":") return false;
    i += zbytek[i + 1] === ":" ? 2 : 1;
    const zacatek = i;
    while (i < zbytek.length && ZNAK_JMENA.test(zbytek[i])) i++;
    if (i === zacatek) return false;
    if (zbytek[i] === "(") {
      const konec = zbytek.indexOf(")", i);
      if (konec < 0) return false;
      i = konec + 1;
    }
  }
  return true;
}

/**
 * Selektor, který editor umí vzít za svůj: řetěz tříd (`.a.b`) nebo jedno id,
 * volitelně se stavy. Totéž co regexy grapesjs parseSelector, jen bez vnořených
 * kvantifikátorů (eslint security/detect-unsafe-regex).
 */
export function jeSelektorEditoru(sel: string): boolean {
  const dvojtecka = sel.indexOf(":");
  const zaklad = dvojtecka < 0 ? sel : sel.slice(0, dvojtecka);
  if (!jsouStavy(dvojtecka < 0 ? "" : sel.slice(dvojtecka))) return false;
  if (zaklad.startsWith("#")) return JMENO.test(zaklad.slice(1));
  if (!zaklad.startsWith(".")) return false;
  return zaklad.slice(1).split(".").every((t) => JMENO.test(t));
}

/** Viz grapesjs parseSelector — jen třídy (a jedno id), zbytek jde do selectorsAdd. */
function parseSelector(str = ""): { result: string[][]; add: string[] } {
  const add: string[] = [];
  const result: string[][] = [];
  for (const kus of str.split(",")) {
    const sel = kus.trim();
    if (jeSelektorEditoru(sel)) result.push(sel.split(/\.(?![^()]*\))/).filter(Boolean));
    else add.push(sel);
  }
  return { add, result };
}

function parseCondition(pravidlo: CSSRule): string {
  const p = pravidlo as CSSRule & { conditionText?: string; media?: MediaList; name?: string; selectorText?: string };
  return (p.conditionText || p.media?.mediaText || p.name || p.selectorText || "").trim();
}

function vytvorUzel(selektory: string[], styl: Record<string, string>, atRule?: string): Uzel {
  const uzel: Uzel = { selectors: selektory, style: styl };
  const posledni = selektory[selektory.length - 1];
  const [, stav] = posledni ? posledni.split(/:(.+)/) : [];
  if (atRule && SAMOSTATNA_AT_JMENA.includes(atRule)) uzel.singleAtRule = true;
  if (atRule) uzel.atRuleType = atRule;
  if (stav) {
    selektory[selektory.length - 1] = posledni.split(/:(.+)/)[0];
    uzel.state = stav;
  }
  return uzel;
}

function vnoritelneAt(pravidlo: CSSRule): string | undefined {
  const text = pravidlo.cssText ?? "";
  return VNORITELNA_AT.find((jmeno) => text.indexOf(`@${jmeno}`) === 0);
}

function parseNode(el: CSSStyleSheet | CSSGroupingRule | CSSRule): Uzel[] {
  let vysledek: Uzel[] = [];
  const pravidla = (el as CSSStyleSheet).cssRules ?? [];
  for (let i = 0; i < pravidla.length; i++) {
    const pravidlo = pravidla[i];
    const typ = pravidlo.type;
    const p = pravidlo as CSSRule & { selectorText?: string; keyText?: string };
    let samostatne = false;
    let atTyp = "";
    let podminka = "";
    const sels = p.selectorText || p.keyText || "";
    const jeSamostatne = SAMOSTATNA_AT.includes(typ);
    if (jeSamostatne) {
      samostatne = true;
      atTyp = AT_PRAVIDLA[typ];
      podminka = parseCondition(pravidlo);
    } else if (AT_KLICE.includes(String(typ)) || (!typ && vnoritelneAt(pravidlo))) {
      const vnorena = parseNode(pravidlo);
      const vnorenyTyp = AT_PRAVIDLA[typ] || vnoritelneAt(pravidlo);
      podminka = parseCondition(pravidlo);
      for (const v of vnorena) {
        if (podminka) v.mediaText = podminka;
        v.atRuleType = vnorenyTyp;
      }
      vysledek = vysledek.concat(vnorena);
    }
    if (!sels && !jeSamostatne) continue;

    const styl = parseStyle(pravidlo);
    const { add, result } = parseSelector(sels);
    let posledni: Uzel | undefined;
    for (const skupina of result) {
      posledni = vytvorUzel(skupina, styl, AT_PRAVIDLA[typ]);
      vysledek.push(posledni);
    }
    if (add.length) {
      const pridane = add.join(", ");
      if (posledni) posledni.selectorsAdd = pridane;
      else {
        const uzel: Uzel = { selectors: [], selectorsAdd: pridane, style: styl };
        if (samostatne) uzel.singleAtRule = samostatne;
        if (atTyp) uzel.atRuleType = atTyp;
        if (podminka) uzel.mediaText = podminka;
        vysledek.push(uzel);
      }
    }
  }
  return vysledek;
}

/** Průchod hotovým seznamem pravidel (CSSOM) — exportováno kvůli testu chování prohlížeče. */
export function pravidlaZeSeznamu(list: Pick<CSSStyleSheet, "cssRules">): Uzel[] {
  return parseNode(list as CSSStyleSheet);
}

/** `parser.parserCss` pro GrapesJS: CSS text → pravidla editoru. */
export function parserCssZachovaPromenne(css: string): Uzel[] {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
  const list = el.sheet;
  document.head.removeChild(el);
  return list ? parseNode(list) : [];
}
