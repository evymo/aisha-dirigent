/**
 * Ikona okna (favicon) a loga z obrázku autora — složené V PROHLÍŽEČI do PNG.
 *
 * Proč v prohlížeči (2026-10-01, z instance — správkyně webu chtěla svou lampu
 * „v modrém kruhu stejné barvy jako pozadí“ a změnu v administraci):
 *   · úložiště SVG záměrně nepřijímá (SVG smí nést `<script>`, servírované z naší
 *     domény by to byl uložený XSS — viz ALLOWED_ASSET_TYPES), loga ale chodí
 *     jako SVG. SVG se proto jen NAČTE jako obrázek (bez skriptů) a nahraje se
 *     vykreslené PNG;
 *   · pozadí (kruh / zaoblený čtverec) a jeho barvu volí autor — žádný grafik
 *     ani nový soubor navíc.
 *
 * Výpočty (rozmístění, barvy) jsou čisté funkce; kreslení potřebuje canvas.
 */

export type TvarPozadi = "zadne" | "kruh" | "ctverec";

export interface VolbyIkony {
  /** Tvar pozadí pod obrázkem. */
  tvar: TvarPozadi;
  /** Barva pozadí jako #rrggbb. */
  barva: string;
  /** Odsazení obrázku od okraje jako podíl strany (0–0,4). */
  okraj: number;
}

/** Strana PNG ikony: 512 px pokryje favicon i ikonu na plochu telefonu. */
export const STRANA_IKONY = 512;

/**
 * Kam obrázek vepsat: zachovat poměr stran, vystředit, odsadit od okraje.
 * U kruhu se navíc vejde do kruhu (vepsaný čtverec = strana / √2).
 */
export function rozmisteni(sirka: number, vyska: number, strana: number, volby: Pick<VolbyIkony, "tvar" | "okraj">) {
  const okraj = Math.min(Math.max(volby.okraj, 0), 0.4);
  const plocha = (volby.tvar === "kruh" ? strana / Math.SQRT2 : strana) * (1 - 2 * okraj);
  const meritko = sirka > 0 && vyska > 0 ? Math.min(plocha / sirka, plocha / vyska) : 0;
  const w = sirka * meritko;
  const h = vyska * meritko;
  return { x: (strana - w) / 2, y: (strana - h) / 2, w, h };
}

/**
 * Barva profilu brandingu („213 82% 50%“, tedy HSL bez obalu) → `#rrggbb`
 * pro výběr barvy. Nečitelná hodnota → `null` (volající dá výchozí).
 */
export function hslNaHex(hsl: string | null | undefined): string | null {
  // Rozklad bez regexu (žádné vnořené kvantifikátory): „H S% L%“.
  const casti = (hsl ?? "").trim().split(/\s+/);
  if (casti.length !== 3 || !casti[1].endsWith("%") || !casti[2].endsWith("%")) return null;
  const cisla = [casti[0], casti[1].slice(0, -1), casti[2].slice(0, -1)];
  if (cisla.some((c) => c === "" || !Number.isFinite(Number(c)))) return null;
  const [hue, sat, lig] = cisla.map(Number);
  if (sat < 0 || lig < 0) return null;
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(sat, 100) / 100;
  const l = Math.min(lig, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Načte soubor obrázku (i SVG) do <img> — bez spouštění čehokoli v něm. */
export function nactiObrazek(soubor: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const adresa = URL.createObjectURL(soubor);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(adresa);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(adresa);
      reject(new Error("obrazek-nejde-nacist"));
    };
    img.src = adresa;
  });
}

/** Přirozené rozměry; SVG bez rozměrů dostane čtverec, ať se dá vykreslit. */
function rozmery(img: HTMLImageElement) {
  const w = img.naturalWidth || img.width || STRANA_IKONY;
  const h = img.naturalHeight || img.height || STRANA_IKONY;
  return { w, h };
}

/** Vykreslí ikonu do připraveného kontextu o straně `strana`. */
export function vykresliIkonu(ctx: CanvasRenderingContext2D, img: HTMLImageElement, strana: number, volby: VolbyIkony) {
  ctx.clearRect(0, 0, strana, strana);
  if (volby.tvar !== "zadne") {
    ctx.fillStyle = volby.barva;
    ctx.beginPath();
    if (volby.tvar === "kruh") {
      ctx.arc(strana / 2, strana / 2, strana / 2, 0, Math.PI * 2);
    } else {
      const r = strana * 0.2;
      ctx.roundRect(0, 0, strana, strana, r);
    }
    ctx.fill();
  }
  const { w, h } = rozmery(img);
  const m = rozmisteni(w, h, strana, volby);
  ctx.drawImage(img, m.x, m.y, m.w, m.h);
}

function platnoNaPng(platno: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    platno.toBlob((b) => (b ? resolve(b) : reject(new Error("png-nejde-vyrobit"))), "image/png");
  });
}

/** Složí ikonu jako PNG soubor připravený k nahrání. */
export async function slozIkonu(zdroj: Blob, volby: VolbyIkony, nazev = "ikona.png"): Promise<File> {
  const img = await nactiObrazek(zdroj);
  const platno = document.createElement("canvas");
  platno.width = STRANA_IKONY;
  platno.height = STRANA_IKONY;
  const ctx = platno.getContext("2d");
  if (!ctx) throw new Error("platno-nedostupne");
  vykresliIkonu(ctx, img, STRANA_IKONY, volby);
  return new File([await platnoNaPng(platno)], nazev, { type: "image/png" });
}

/**
 * SVG logo → PNG o šířce `sirka` (výška podle poměru stran). Ostatní obrázky
 * se vrací beze změny — ty úložiště přijme samo.
 */
export async function svgNaPng(soubor: File, sirka = 1200): Promise<File> {
  if (soubor.type !== "image/svg+xml") return soubor;
  const img = await nactiObrazek(soubor);
  const { w, h } = rozmery(img);
  const platno = document.createElement("canvas");
  platno.width = sirka;
  platno.height = Math.max(1, Math.round((sirka * h) / w));
  const ctx = platno.getContext("2d");
  if (!ctx) throw new Error("platno-nedostupne");
  ctx.drawImage(img, 0, 0, platno.width, platno.height);
  return new File([await platnoNaPng(platno)], soubor.name.replace(/\.svg$/i, "") + ".png", { type: "image/png" });
}
