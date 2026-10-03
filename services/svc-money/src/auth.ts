/**
 * Kdo se smí ptát do účetnictví.
 *
 * ⛔ PROČ TO NENÍ „vnitřní síť stačí"
 * Služba vydává obsah dokladů — částky, protistrany, splatnosti. To, že sedí na
 * vnitřní síti, není autorizace: uvnitř běží desítky kontejnerů a kterýkoli z nich
 * by se mohl zeptat. Sdílená síť je dosažitelnost, ne oprávnění.
 *
 * Pověření se porovnává v KONSTANTNÍM ČASE — porovnání se zkratem na prvním
 * rozdílu prozrazuje délku shodného prefixu a token se dá uhádnout znak po znaku.
 */
import { timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message = 'neautorizováno') {
    super(message);
    this.name = 'AuthError';
  }
}

function rovnoCasove(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // Rozdílná délka se prozradit smí (jinak nejde vrátit false), obsah ne.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Ověří `Authorization: Bearer <token>` proti pověření z prostředí.
 *
 * Chybějící `SVC_MONEY_API_TOKEN` NENÍ „vypnutá autorizace" — je to chybějící
 * vstup, takže se odmítá všechno. Volnější varianta by znamenala, že překlep
 * v proměnné tiše otevře účetnictví celé vnitřní síti.
 */
export function verifyToken(authHeader: string | undefined, expected = process.env.SVC_MONEY_API_TOKEN ?? ''): void {
  if (!expected) throw new AuthError('SVC_MONEY_API_TOKEN není nastavený — služba odmítá vše');
  if (!authHeader?.startsWith('Bearer ')) throw new AuthError();
  if (!rovnoCasove(authHeader.slice(7).trim(), expected)) throw new AuthError();
}
