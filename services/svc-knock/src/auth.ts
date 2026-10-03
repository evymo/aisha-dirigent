/**
 * Čím se prokazuje ten, kdo klepe.
 *
 * ⭐ AUTORIZACE TÉHLE SLUŽBY JE HMAC PODPIS RÁMCE, ne hlavička požadavku.
 * Datagram nemá session, nemá se čím prokázat opakovaně a listener na něj
 * zásadně neodpovídá (K2). Jediné, co odesílatele identifikuje, je podpis
 * počítaný klíčem z rosteru — ověřuje se v konstantním čase, takže se z doby
 * odpovědi nedá nic odvodit (a odpověď stejně žádná není).
 *
 * Proč to bydlí zvlášť a ne v obsluze datagramu: rozhodnutí „pustit dál" má mít
 * jedno pojmenované místo. Když je rozpuštěné v obsluze, časem k němu přiroste
 * druhá cesta a nikdo si toho nevšimne.
 */
import { verifyFrame, type DecodedFrame, type VerifyReason } from '@aisha/knock-protocol';
import { nodeCrypto } from '@aisha/knock-protocol/node';
import type { KnockConfig } from './config.js';

export interface AuthVysledek {
  ok: boolean;
  reason: VerifyReason;
}

/**
 * Ověří podpis rámce (HMAC-SHA256) a všechno, co za ním následuje: časové okno,
 * přehrání, kontrolní číslici a rozsah oprávnění.
 *
 * ⛔ Pořadí kontrol je součást návrhu, ne detail: cokoli za `bad-hmac` je
 * dosažitelné až POTÉ, co podpis prošel. Z důvodu odmítnutí se tak dá poznat,
 * jestli odesílatel klíč drží — a na tom stojí rozhodnutí, koho zabanovat.
 */
export function authenticateFrame(frame: DecodedFrame, cfg: KnockConfig, nowSec: number,
                                  nonceSeen: (nonce: string) => boolean): AuthVysledek {
  return verifyFrame(frame, {
    crypto: nodeCrypto,
    operators: cfg.operators,
    now: nowSec,
    windowSec: cfg.windowSec,
    otpStep: cfg.otpStep,
    otpDigits: cfg.otpDigits,
    otpSkew: cfg.otpSkew,
    nonceSeen,
  });
}
