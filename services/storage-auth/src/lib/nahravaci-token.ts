import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Nahrávací token — právo na JEDEN PUT do JEDNOHO objektu, vydané preflightem.
 *
 * ⭐ PROČ NE PRESIGNED URL MINIA: presigned URL nese hostitele, proti kterému se
 * podepsala, a to je `MINIO_ENDPOINT` — jméno v meshi. Telefon nebo tablet
 * mimo mesh ho nepřeloží, takže fotka předání „nahrávaná“ z terénu nikdy
 * nedorazila (naměřeno 2026-09-18: guru curl 000, riq táž konfigurace).
 * Nahrání proto jde přes API (za dveřmi, které klient stejně otevírá) a
 * storage-auth tělo streamuje do MinIA sám. MinIO zůstává skryté.
 *
 * Token je stejně úzký jako presigned URL: bucket, klíč, typ, strop velikosti
 * a expirace, podepsané HMAC-SHA256. Čistý modul bez I/O.
 */
export interface NahravaciPravo {
  /** bucket */
  b: string;
  /** klíč objektu */
  k: string;
  /** Content-Type, který preflight schválil */
  t: string;
  /** strop velikosti v bajtech */
  max: number;
  /** expirace, sekundy od epochy */
  exp: number;
  /**
   * Řádek dokumentu, do kterého se po skenu zapíše verdikt (zdravotní dokumenty).
   * Volitelné: nahrávky bez evidence ho nemají. V tokenu je pod HMAC, takže ho klient
   * nepodvrhne — proto ho `/nahrani` smí použít bez dalšího ověření (2026-09-23).
   */
  d?: string;
}

export class TokenError extends Error {
  constructor(public readonly duvod: 'tvar' | 'podpis' | 'expirace') {
    super(`upload token: ${duvod}`);
    this.name = 'TokenError';
  }
}

/** Kratší tajemství by z HMAC dělalo formalitu. */
export const MIN_DELKA_TAJEMSTVI = 32;

function podpis(data: string, tajemstvi: string): Buffer {
  return createHmac('sha256', tajemstvi).update(data).digest();
}

export function vydejToken(pravo: NahravaciPravo, tajemstvi: string): string {
  if (tajemstvi.length < MIN_DELKA_TAJEMSTVI) throw new Error('upload token secret too short');
  const data = Buffer.from(JSON.stringify(pravo)).toString('base64url');
  return `${data}.${podpis(data, tajemstvi).toString('base64url')}`;
}

export function overToken(token: string, tajemstvi: string, tedSekund: number = Date.now() / 1000): NahravaciPravo {
  const [data, sig, navic] = token.split('.');
  if (!data || !sig || navic !== undefined) throw new TokenError('tvar');
  const ocekavany = podpis(data, tajemstvi);
  const dany = Buffer.from(sig, 'base64url');
  // Porovnání v konstantním čase; různá délka = rovnou špatně (timingSafeEqual by vyhodil).
  if (dany.length !== ocekavany.length || !timingSafeEqual(dany, ocekavany)) throw new TokenError('podpis');
  let pravo: NahravaciPravo;
  try {
    pravo = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as NahravaciPravo;
  } catch {
    // Podpis sedí, ale obsah není JSON — vydali jsme ho my, takže je to vada
    // vydání, ne útok; pro klienta je to stejně jen neplatný token.
    throw new TokenError('tvar');
  }
  if (typeof pravo.b !== 'string' || typeof pravo.k !== 'string' || typeof pravo.t !== 'string'
      || typeof pravo.max !== 'number' || typeof pravo.exp !== 'number'
      // Pole navíc starší ověřovatel ignoruje; nový drží tvar přísně i u volitelného.
      || (pravo.d !== undefined && typeof pravo.d !== 'string')) {
    throw new TokenError('tvar');
  }
  if (pravo.exp <= tedSekund) throw new TokenError('expirace');
  return pravo;
}
