import { config } from './config.js';
import { createSignedUploadUrl } from './minio.js';
import { vydejToken } from './lib/nahravaci-token.js';

/**
 * Kam má klient poslat PUT s obsahem souboru.
 *
 * S veřejnou adresou storage a tajemstvím tokenu: na API (`/nahrani/<token>`),
 * odkud storage-auth tělo streamuje do MinIA — dosažitelné odkudkoli, kam
 * dosáhne API. Bez nich (lokální vývoj s dosažitelným MinIEM): presigned URL.
 */
export async function createUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  maxBytes: number,
  /** Řádek dokumentu pro zápis verdiktu po skenu; jen cesta přes API ho unese. */
  documentId?: string,
): Promise<string> {
  if (config.storagePublicUrl && config.uploadTokenSecret) {
    const token = vydejToken(
      {
        b: bucket,
        k: key,
        t: contentType,
        max: maxBytes,
        exp: Math.floor(Date.now() / 1000) + config.uploadUrlTtlSeconds,
        ...(documentId ? { d: documentId } : {}),
      },
      config.uploadTokenSecret,
    );
    return `${config.storagePublicUrl}/nahrani/${token}`;
  }
  return createSignedUploadUrl(bucket, key);
}
