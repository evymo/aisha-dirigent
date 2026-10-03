/**
 * Turning drawn strokes into the value the evidence contract accepts.
 *
 * `submit_evidence_review_audited` checks two things about a signature and
 * raises on either: it must match `data:image/%`, and it must be under 262144
 * bytes. Both are mirrored here so the person at the tailgate gets told to sign
 * again, instead of reading a Postgres exception. Pure, so the rule and its test
 * are one thing (same reason `extranet/arrange` is pure).
 */

/** The server's ceiling, mirrored — not a guess. */
export const MAX_SIGNATURE_BYTES = 262144;

/**
 * A signature is a DOCUMENT, not app chrome: dark ink on white, identical in
 * every theme and in whatever viewer opens it later. Theming it would make the
 * same evidence look different depending on who exported it.
 */
export const INK = "#111111";
export const PAPER = "#FFFFFF";

/**
 * Build the data URI, or null when nothing was drawn.
 *
 * SVG rather than PNG: React Native has no canvas, and every rasterising
 * alternative is a new native dependency — a poor trade in a codebase that just
 * paid for compiling unowned native code. Vector also keeps the payload at a
 * few kilobytes, so the size ceiling is never in play and the mark stays sharp.
 * Percent-encoded rather than base64 because the app carries no base64 helper
 * and `encodeURIComponent` is already correct for a data URI.
 */
export function strokesToDataUri(strokes: readonly string[], width: number, height: number): string | null {
  const drawn = strokes.filter((d) => !!d && d.trim().length > 0);
  if (!drawn.length) return null;

  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const paths = drawn
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.5" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${PAPER}"/>${paths}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Nejkratší značka, kterou uznáme za podpis — v dp uražené dráhy.
 *
 * ⛔ NAMĚŘENO 2026-08-20: JEDINÝ DOTEK PROŠEL. `strokesToDataUri` bere každý
 * neprázdný tah, a klepnutí vyrobí platnou cestu `M 100 50`. Přebírající tedy
 * mohl omylem ťuknout do plochy, „Hotovo" se rozsvítilo a řidič odeslal
 * předání se značkou, která neznamená nic — a zjistí se to při reklamaci,
 * kdy je podpis to jediné, oč jde.
 *
 * ⚠️ MĚŘÍ SE CELÁ ZNAČKA, NE JEDNOTLIVÝ TAH. Tečka UVNITŘ podpisu je legitimní
 * (háček, tečka nad i) a nesmí se zahazovat; vadná je značka, která je JEN
 * z teček. Rozdíl je v součtu přes všechny tahy.
 *
 * 60 dp je záměrně nízko: horní mez si nikdo nezaslouží a odmítnout člověka
 * s drobným podpisem je horší vada než přijmout ťuknutí. Odmítne se tím tečka
 * a čárka, ne podpis.
 */
export const MIN_ZNACKA_DP = 60;

/**
 * Kolik dráhy člověk na ploše urazil — součet přes všechny tahy.
 *
 * Cesty skládá `SignaturePad` ve tvaru `M x y L x y …`; čte se z nich prostě
 * posloupnost bodů. Neznámý tvar vrátí nulu — tvrdit délku z něčeho, čemu
 * nerozumíme, by bylo horší než říct „nic".
 */
export function delkaZnacky(strokes: readonly string[]): number {
  let celkem = 0;
  for (const tah of strokes) {
    // Bez vnořeného kvantifikátoru (`\d+(?:\.\d+)?` má hvězdnou výšku 2 a lint
    // ho právem hlásí): tady stačí prostý tvar čísla.
    const cisla = String(tah ?? "").match(/-?\d*\.?\d+/g);
    if (!cisla || cisla.length < 4) continue;
    for (let i = 2; i + 1 < cisla.length; i += 2) {
      const dx = Number(cisla[i]) - Number(cisla[i - 2]);
      const dy = Number(cisla[i + 1]) - Number(cisla[i - 1]);
      celkem += Math.hypot(dx, dy);
    }
  }
  return celkem;
}

/** Je to podpis, nebo jen dotek do plochy? */
export function jeToPodpis(strokes: readonly string[]): boolean {
  return delkaZnacky(strokes) >= MIN_ZNACKA_DP;
}

/** Whether a built URI would survive the server's size check. */
export function fitsSignatureLimit(dataUri: string): boolean {
  return dataUri.length <= MAX_SIGNATURE_BYTES;
}
