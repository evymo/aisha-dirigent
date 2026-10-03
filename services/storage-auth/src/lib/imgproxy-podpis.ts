/**
 * imgproxy: podepsaná cesta a volby zpracování pro doručení veřejných obrázků.
 *
 * Obrázek se v úložišti NIKDY nemění. Výřez, ohnisko a přiblížení jsou tři čísla
 * u článku (image_focus_x/y, image_zoom) a každý blok si o výřez řekne parametry
 * `?w=&h=&fx=&fy=&z=` na `/object/public/<bucket>/<klíč>`. Tady se z nich staví
 * cesta pro imgproxy a PODEPISUJE se — instance má IMGPROXY_KEY/SALT nastavené,
 * takže nepodepsanou (`/insecure/`) cestu imgproxy odmítne. Bez podpisu by navíc
 * kdokoli mohl skládat libovolné transformace; bílá listina parametrů je tady.
 *
 * Postup pro přiblížení: výřez o straně 1/zoom (relativně k rozměrům originálu)
 * se centruje na ohnisko a přitiskne k okrajům (`c:š:v:fp:x:y`), pak se výsledek
 * vyplní do cílového rozměru (`rs:fill:w:h`) s ohniskem přepočteným do souřadnic
 * VÝŘEZU (`g:fp`). Bez přiblížení se vyplňuje rovnou s ohniskem originálu.
 */
import { createHmac } from 'node:crypto';

export interface ParametryZpracovani {
  /** Cílová šířka a výška v px (1..MAX_ROZMER). */
  w: number;
  h: number;
  /** Ohnisko 0..1 (zleva, shora). */
  fx: number;
  fy: number;
  /** Přiblížení 1..4 (1 = celý obrázek). */
  zoom: number;
}

export type VystupniFormat = 'webp' | 'jpg' | 'png' | 'gif';

/** Horní mez rozměru: nad ní se už nejedná o doručení pro web, ale o export. */
export const MAX_ROZMER = 4000;
/** Rozměr pro obrázek, který se musí převést (HEIC), ale blok si o velikost neřekl. */
export const VYCHOZI_ROZMER_PREVODU = 2000;

const n3 = (x: number): string => Number(x.toFixed(3)).toString();

/**
 * Ohnisko po výřezu: výřez o straně 1/zoom se centruje na ohnisko a přitiskne
 * k okrajům; vrátí polohu ohniska uvnitř toho výřezu (0..1).
 */
export function ohniskoPoVyrezu(f: number, zoom: number): number {
  if (zoom <= 1) return f;
  const strana = 1 / zoom;
  const od = Math.min(Math.max(f - strana / 2, 0), 1 - strana);
  return Math.min(Math.max((f - od) / strana, 0), 1);
}

/** Volby zpracování jako segmenty cesty imgproxy (bez zdroje). */
export function sestavZpracovani(p: ParametryZpracovani, rezim: 'fill' | 'fit' = 'fill'): string {
  const casti: string[] = [];
  if (p.zoom > 1) {
    const strana = n3(1 / p.zoom);
    casti.push(`c:${strana}:${strana}:fp:${n3(p.fx)}:${n3(p.fy)}`);
  }
  casti.push(`rs:${rezim}:${p.w}:${p.h}`);
  if (rezim === 'fill') {
    casti.push(`g:fp:${n3(ohniskoPoVyrezu(p.fx, p.zoom))}:${n3(ohniskoPoVyrezu(p.fy, p.zoom))}`);
  }
  return `/${casti.join('/')}`;
}

/** Zdroj v MinIO + výstupní formát (`@webp`). Klíč je sanitizovaný preflightem. */
export function cestaZdroje(bucket: string, key: string, format: VystupniFormat): string {
  return `/plain/s3://${bucket}/${key}@${format}`;
}

/** Podpis cesty podle imgproxy: base64url(HMAC-SHA256(key, salt || cesta)). */
export function podepisCestu(cesta: string, keyHex: string, saltHex: string): string {
  const hmac = createHmac('sha256', Buffer.from(keyHex, 'hex'));
  hmac.update(Buffer.from(saltHex, 'hex'));
  hmac.update(cesta);
  return hmac.digest('base64url');
}

export function podepsanaAdresa(imgproxyUrl: string, cesta: string, keyHex: string, saltHex: string): string {
  return `${imgproxyUrl.replace(/\/+$/, '')}/${podepisCestu(cesta, keyHex, saltHex)}${cesta}`;
}

export type VysledekParametru =
  | { ok: true; hodnoty: ParametryZpracovani | null }
  | { ok: false; chyba: string };

/**
 * Bílá listina parametrů dotazu. Žádný parametr = žádná transformace (null).
 * `w` a `h` jsou povinné, jakmile je cokoli z transformace přítomné — bez cíle
 * není co vyplňovat a „nějaký rozměr" se nedosazuje.
 */
export function overParametry(dotaz: Record<string, unknown>): VysledekParametru {
  const je = (k: string): boolean => dotaz[k] !== undefined && dotaz[k] !== '';
  if (!['w', 'h', 'fx', 'fy', 'z'].some(je)) return { ok: true, hodnoty: null };

  const cele = (k: string, min: number, max: number): number => {
    const v = Number(dotaz[k]);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${k} must be an integer ${min}..${max}`);
    return v;
  };
  const desetinne = (k: string, min: number, max: number, vychozi: number): number => {
    if (!je(k)) return vychozi;
    const v = Number(dotaz[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${k} must be a number ${min}..${max}`);
    return v;
  };
  try {
    if (!je('w') || !je('h')) throw new Error('w and h are required with any transform');
    return {
      ok: true,
      hodnoty: {
        w: cele('w', 1, MAX_ROZMER),
        h: cele('h', 1, MAX_ROZMER),
        fx: desetinne('fx', 0, 1, 0.5),
        fy: desetinne('fy', 0, 1, 0.5),
        zoom: desetinne('z', 1, 4, 1),
      },
    };
  } catch (err) {
    return { ok: false, chyba: err instanceof Error ? err.message : String(err) };
  }
}

/** Klíče, které prohlížeč neumí zobrazit sám — jdou přes imgproxy vždy. */
export function vyzadujePrevod(key: string): boolean {
  return /\.(heic|heif)$/i.test(key);
}

/**
 * Výstupní formát: gif zůstává gif (animace), jinak webp, když ho prohlížeč
 * přijímá, jinak png pro png (průhlednost) a jpg pro zbytek včetně HEIC.
 * Rozhoduje se tady, ne detekcí v imgproxy — odpověď je pak deterministická
 * a `Vary: Accept` říká cachi, na čem závisí.
 */
export function vystupniFormat(accept: string | undefined, key: string): VystupniFormat {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'gif') return 'gif';
  if ((accept ?? '').includes('image/webp')) return 'webp';
  return ext === 'png' ? 'png' : 'jpg';
}
