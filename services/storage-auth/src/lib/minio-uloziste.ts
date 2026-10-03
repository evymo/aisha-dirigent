import { statObjectOrNull } from '../minio.js';
import type { Uloziste } from './overeni-baliku.js';

/**
 * Úložiště pro ověření balíčků — jen ČTENÍ otisku.
 *
 * ⛔ OTISK SE BERE Z METADAT, KTERÁ ZAPSAL NAHRÁVACÍ KROK, ne z ETagu. ETag je
 * u vícedílného nahrání otisk ČÁSTÍ, ne obsahu, a u 86MB appky se vícedílné
 * nahrání použije — porovnání proti deklaraci by tedy nesedělo vždycky, ale jen
 * někdy. Porucha, která závisí na velikosti souboru, se hledá nejhůř.
 */
export function minioUloziste(bucket: string): Uloziste {
  return {
    async otisk(klic: string): Promise<string | null> {
      const o = await statObjectOrNull(bucket, klic);
      if (!o) return null;
      const z = o.metaData['x-amz-meta-sha256'] ?? o.metaData.sha256;
      return typeof z === 'string' && z.length === 64 ? z.toLowerCase() : null;
    },
  };
}
