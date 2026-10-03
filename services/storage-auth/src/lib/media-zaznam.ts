/**
 * Záznam nahraného média do evidence (`media_assets`) — galerie v administraci.
 *
 * Úložiště výpis objektů neumí a umět nemá (výpis bucketu = právo na celý
 * prefix). Záznam proto vzniká tady, ve chvíli, kdy objekt PROŠEL antivirem
 * a leží v cílovém VEŘEJNÉM bucketu — dřív ne, jinak by galerie nabízela
 * obrázek, který se nikdy neservíruje. Zapisuje se pod service_role přes
 * `record_media_asset` (jen service_role smí), idempotentně po klíči objektu.
 *
 * Kdo nahrál a jak se soubor jmenoval, se čte z KLÍČE, který razí preflight
 * (`<userId>/<uuid>_<jméno>`), ne z těla požadavku.
 */
import { config } from '../config.js';
import { guardedFetch } from './guarded-fetch.js';

export interface Medium {
  bucket: string;
  objectKey: string;
  contentType: string;
  bytes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<userId>/<uuid>_<jméno>` → kdo nahrál a původní jméno; cizí tvar → null. */
export function rozlozKlic(objectKey: string): { uploadedBy: string | null; originalName: string | null } {
  const [prvni, ...zbytek] = objectKey.split('/');
  const posledni = zbytek[zbytek.length - 1] ?? '';
  const podtrzitko = posledni.indexOf('_');
  const jmeno = podtrzitko > 0 && UUID.test(posledni.slice(0, podtrzitko)) ? posledni.slice(podtrzitko + 1) : null;
  return {
    uploadedBy: UUID.test(prvni) ? prvni : null,
    originalName: jmeno && jmeno.length > 0 ? jmeno : null,
  };
}

/** Zapíše záznam; selhání hází — volající rozhodne, zda je to konec požadavku. */
export async function zapisMedium(m: Medium): Promise<void> {
  const { uploadedBy, originalName } = rozlozKlic(m.objectKey);
  const res = await guardedFetch(`${config.postgrestUrl}/rpc/record_media_asset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.postgrestServiceToken}`,
    },
    body: JSON.stringify({
      p_bucket: m.bucket,
      p_bytes: m.bytes,
      p_content_type: m.contentType,
      p_object_key: m.objectKey,
      p_original_name: originalName,
      p_uploaded_by: uploadedBy,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`record_media_asset failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
