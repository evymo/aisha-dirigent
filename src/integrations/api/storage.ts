/**
 * Storage client — replaces aisha.storage.from(bucket).
 *
 * Talks to the Storage Auth Microservice via the gateway proxy
 * at /storage/v1/*. Supports upload, delete, signed URLs, and
 * public URL generation (via imgproxy).
 *
 * @module
 */
import { getAccessToken } from '@/integrations/auth/oidc-client';
import { safeError, safeWarn } from '@/lib/security/safeLogger';
import { nahraniSPrubehem } from '@/lib/nahravani/nahraniSPrubehem';
import { gatewayUrl } from './client';

import type { ApiError } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a storage upload operation. */
export type StorageUploadResult = {
  data: { path: string } | null;
  error: ApiError | null;
};

/** Result of a storage delete operation. */
export type StorageDeleteResult = {
  data: null;
  error: ApiError | null;
};

/** Result of a signed URL request. */
export type StorageSignedUrlResult = {
  data: { signedUrl: string } | null;
  error: ApiError | null;
};

/** Upload options matching the aisha-js interface. */
export type StorageUploadOptions = {
  /** Cache-Control header value (e.g. "3600"). */
  cacheControl?: string;
  /** If true, overwrites existing file at the same path. */
  upsert?: boolean;
  /** Content-Type override. If omitted, derived from File. */
  contentType?: string;
  /** Průběh odesílání bajtů (0..1) — jen fáze PUT; preflight a sken průběh nemají. */
  onProgress?: (podil: number) => void;
  /** Zrušení nahrání (přeruší PUT; objekt v karanténě se nikdy neservíruje). */
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Storage bucket handle
// ---------------------------------------------------------------------------

/**
 * Ohlásí serveru, že PUT na podepsanou adresu dobehl — a tím SPUSTÍ ANTIVIROVÝ SKEN.
 *
 * Přes API (`/nahrani/<token>`) je sken hotový už na konci PUTu a tahle routa jen
 * potvrdí konečný klíč (je idempotentní). Na presigned cestě (instance bez
 * STORAGE_PUBLIC_URL) PUT jde mimo storage-auth — tam teprve tohle volání sken spustí
 * a bez něj objekt zůstane v karanténě, která se z ničeho neservíruje. Krok je tady
 * jedenkrát a používají ho oba toky (obecný upload i zdravotní dokumenty).
 *
 * @param quarantineKey - Klíč z preflightu (`<cílovýBucket>/<userId>/<uuid>_<jméno>`).
 * @param documentId - Volitelný řádek dokumentu, do kterého se zapíše verdikt.
 * @returns Klíč v CÍLOVÉM bucketu po promoci, nebo chyba (422 infikované, 502 sken nedostupný).
 */
export async function dokonciNahrani(
  quarantineKey: string,
  documentId?: string,
): Promise<{ data: { path: string } | null; error: ApiError | null }> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${gatewayUrl}/storage/v1/upload-complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ objectKey: quarantineKey, ...(documentId ? { documentId } : {}) }),
      signal: AbortSignal.timeout(180_000), // sken velkého souboru trvá
    });

    if (!res.ok) {
      const errBody = await res.json().catch((e: unknown) => {
        safeError('storage.uploadComplete.parseError', e);
        return {};
      });
      return {
        data: null,
        error: {
          message: (errBody as Record<string, string>).message
            ?? (errBody as Record<string, string>).error
            ?? res.statusText,
          code: String(res.status),
        },
      };
    }

    const promovano = (await res.json()) as { objectKey?: string };
    return { data: { path: promovano.objectKey ?? quarantineKey }, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'Upload completion failed' },
    };
  }
}

/**
 * Storage bucket handle — drop-in for `aisha.storage.from(bucket)`.
 *
 * @example
 * ```ts
 * import { storage } from "@/integrations/api/storage";
 * const bucket = storage.from("page-assets");
 * const { error } = await bucket.upload("path/file.png", file, { upsert: true });
 * const { data } = bucket.getPublicUrl("path/file.png");
 * ```
 */
class StorageBucket {
  constructor(private readonly bucket: string) {}

  /**
   * Upload a file to the bucket.
   *
   * ⛔ DVĚ VOLÁNÍ, NE JEDNO — a je to naměřená oprava (2026-09-21).
   *
   * Dřív tu bylo `POST /storage/v1/object/{bucket}/{path}` s tělem souboru, což je
   * kontrakt hostovaného storage API. Naše `storage-auth` takovou routu NEMÁ:
   * měřeno přes veřejnou bránu, ten POST vrací **404**, zatímco
   * `POST /storage/v1/upload-preflight` vrací 401 (tedy existuje a chce token).
   * Nahrávání obrázků v editoru stránek tím bylo mrtvé od začátku — a nikdo si toho
   * nevšiml, protože obsah webu se udržoval ručně v SQL a obrázky se hotlinkovaly
   * z cizího webu (naměřeno v živé DB 2026-09-21: 256 výskytů `<img src>` na
   * cizím webu jedné instance, z toho 185 unikátních obrázků, + 51 titulních obrázků).
   *
   * Skutečný tok je server-mediated a má TŘI kroky: preflight ověří token, roli,
   * velikost a MIME a vydá presigned PUT do KARANTÉNNÍHO bucketu; klient PUTne bajty
   * přímo tam; a pak ohlásí `/upload-complete`, které objekt oskenuje (clamd,
   * fail-closed) a teprve při čistém verdiktu promuje do cílového bucketu.
   *
   * PUT jde přes XMLHttpRequest (lib/nahravani/nahraniSPrubehem.ts), protože `fetch`
   * průběh odesílání neumí — a bez průběhu je nahrání 20 MB fotky pro autora
   * jen zamrzlé tlačítko (2026-09-24).
   *
   * @param path - Object path within the bucket (jen doporučení — server si klíč razí sám).
   * @param file - File or Blob to upload.
   * @param options - Upload options.
   */
  async upload(
    path: string,
    file: File | Blob,
    options?: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    try {
      const token = await getAccessToken();
      const contentType = options?.contentType
        ?? (file instanceof File ? file.type : 'application/octet-stream');
      const filename = path.split('/').pop() || (file instanceof File ? file.name : 'upload.bin');

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const preflight = await fetch(`${gatewayUrl}/storage/v1/upload-preflight`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bucket: this.bucket,
          filename,
          contentType,
          fileSizeBytes: file.size,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!preflight.ok) {
        const errBody = await preflight.json().catch((e: unknown) => {
          safeError('storage.upload.preflightParseError', e);
          return {};
        });
        return {
          data: null,
          error: {
            message: (errBody as Record<string, string>).message
              ?? (errBody as Record<string, string>).error
              ?? preflight.statusText,
            code: String(preflight.status),
          },
        };
      }

      const { uploadUrl, quarantineKey } = (await preflight.json()) as {
        uploadUrl: string;
        quarantineKey: string;
      };

      // Bajty jdou PŘÍMO na podepsanou URL — bez tokenu (podpis JE oprávnění) a bez
      // proxy, aby velký soubor neprotékal branou.
      const put = await nahraniSPrubehem(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
        onProgress: options?.onProgress ? (podil) => options.onProgress?.(podil) : undefined,
        signal: options?.signal,
        timeoutMs: 120_000, // 2 min pro velké soubory
      });

      if (!put.ok) {
        const telo = put.json<{ error?: string; message?: string }>();
        return {
          data: null,
          error: { message: telo?.message ?? telo?.error ?? `Upload failed (${put.status})`, code: String(put.status) },
        };
      }

      // ⛔ TŘETÍ VOLÁNÍ UZAVÍRÁ OBĚ CESTY (2026-09-21, upřesněno 2026-09-23).
      //
      // PUT doručí bajty do KARANTÉNNÍHO bucketu. Přes API (`/nahrani/<token>`) je sken
      // a promoce hotová už na konci PUTu; presigned cesta (instance bez
      // STORAGE_PUBLIC_URL) jde mimo storage-auth a tam sken spustí až tohle ohlášení.
      // Klient neví, kudy jeho PUT šel, proto volá vždy — routa je idempotentní a hotový
      // objekt vrátí jako 200. Adresa obrázku smí vzniknout až z její odpovědi.
      const dokonceno = await dokonciNahrani(quarantineKey);
      if (dokonceno.error || !dokonceno.data) {
        return { data: null, error: dokonceno.error };
      }

      // Klíč razí server, promoci potvrzuje server — volající dostane TEN klíč,
      // ne ten, o který si řekl, a jen když objekt opravdu prošel skenem.
      return { data: { path: dokonceno.data.path }, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Upload failed' },
      };
    }
  }

  /**
   * Delete files from the bucket.
   *
   * `DELETE /storage/v1/object/{bucket}/{path}` — JEDEN OBJEKT NA VOLÁNÍ.
   *
   * ⛔ Dřív tu bylo jedno `DELETE /storage/v1/object/{bucket}` s tělem
   * `{prefixes:[…]}`. To je dávkový kontrakt hostovaného storage API; naše
   * `storage-auth` ho nemá (naměřeno přes veřejnou bránu: **404**), takže
   * mazání nikdy nic nesmazalo. Nová routa mluví o jednom objektu, protože
   * tak je autorizovatelná: „smaž tenhle klíč ve veřejném bucketu, jsi-li
   * admin/staff" — kdežto prefix je maskovaný `rm -rf`.
   *
   * Volání jdou postupně, ne paralelně: chceme, aby první odmítnutí (403)
   * zastavilo zbytek, ne aby se pokusilo o všechny a hlásilo jedno z nich.
   *
   * @param paths - Object paths to delete.
   */
  async remove(paths: string[]): Promise<StorageDeleteResult> {
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      for (const path of paths) {
        const url = `${gatewayUrl}/storage/v1/object/${this.bucket}/${path}`;
        const response = await fetch(url, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const errBody = await response.json().catch((e: unknown) => {
            safeError('storage.remove.parseError', e);
            return {};
          });
          return {
            data: null,
            error: {
              message: (errBody as Record<string, string>).message ?? response.statusText,
              code: String(response.status),
            },
          };
        }
      }

      return { data: null, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Delete failed' },
      };
    }
  }

  /**
   * Get a public URL for a file.
   *
   * No HTTP call — constructs the URL from gateway + bucket + path.
   * Public buckets are served via imgproxy for on-the-fly transforms.
   *
   * @param path - Object path within the bucket.
   * @returns Object with `data.publicUrl`.
   */
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    const publicUrl = `${gatewayUrl}/storage/v1/object/public/${this.bucket}/${path}`;
    return { data: { publicUrl } };
  }

  /**
   * Create a time-limited signed URL for private file access.
   *
   * `GET /storage/v1/object/sign/{bucket}/{path}`
   *
   * ⚠️ Metoda je GET, ne POST. Routa ve `storage-auth` je registrovaná jako
   * `app.get('/object/sign/:bucket/*')`; klient sem posílal POST s tělem
   * `{expiresIn}`, na které routa neodpoví. TTL si stejně určuje server
   * (`config.downloadUrlTtlSeconds`) — parametr zůstává v podpisu, protože
   * volající ho předává, ale putuje jako dotaz, ne jako přání v těle.
   *
   * @param path - Object path within the bucket.
   * @param expiresIn - Expiration time in seconds.
   */
  async createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<StorageSignedUrlResult> {
    try {
      const token = await getAccessToken();
      const url = `${gatewayUrl}/storage/v1/object/sign/${this.bucket}/${path}?expiresIn=${encodeURIComponent(String(expiresIn))}`;

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errBody = await response.json().catch((e: unknown) => {
          safeError('storage.signedUrl.parseError', e);
          return {};
        });
        return {
          data: null,
          error: {
            message: (errBody as Record<string, string>).message ?? response.statusText,
          },
        };
      }

      const body = await response.json() as { signedURL?: string; signedUrl?: string };
      const signedUrl = body.signedURL ?? body.signedUrl ?? '';
      // Signed URL from Storage Auth may be relative — prefix with gateway.
      const fullUrl = signedUrl.startsWith('http') ? signedUrl : `${gatewayUrl}${signedUrl}`;

      return { data: { signedUrl: fullUrl }, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Signed URL failed' },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Storage client — drop-in for `aisha.storage`.
 *
 * @example
 * ```ts
 * import { storage } from "@/integrations/api/storage";
 * const { error } = await storage.from("page-assets").upload("hero.png", file);
 * ```
 */
export const storage = {
  /**
   * Get a bucket handle for upload/delete/URL operations.
   *
   * @param bucket - Bucket name (e.g. "page-assets", "health-documents").
   * @returns StorageBucket instance.
   */
  from(bucket: string): StorageBucket {
    return new StorageBucket(bucket);
  },
};
