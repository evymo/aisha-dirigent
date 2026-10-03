import * as Minio from 'minio';
import type { Readable } from 'node:stream';
import { config } from './config.js';

/**
 * MinIO access — the single storage module for storage-auth. Built on the lightweight,
 * MinIO-native `minio` client (Apache-2.0) rather than the heavy AWS SDK: one small dependency,
 * no AWS branding/lock-in, and the natural client for an S3-compatible self-hosted store.
 *
 * No direct bucket access from clients; everything is mediated through this module (presigned
 * URLs for browser upload/download + service-role server-side ops for the AV scan→promote flow).
 */

// `minio.Client` takes host/port/useSSL separately, so derive them from the endpoint URL
// (e.g. http://minio:9000 → endPoint=minio, port=9000, useSSL=false).
const endpointUrl = new URL(config.minioEndpoint);
const ENDPOINT = {
  endPoint: endpointUrl.hostname,
  port: endpointUrl.port ? Number(endpointUrl.port) : endpointUrl.protocol === 'https:' ? 443 : 80,
  useSSL: endpointUrl.protocol === 'https:',
};

/**
 * Construct a configured MinIO client. Exported so init/test code reuses the SAME construction
 * (one source of truth for endpoint + credentials) instead of re-deriving it.
 */
export function createMinioClient(): Minio.Client {
  return new Minio.Client({
    ...ENDPOINT,
    accessKey: config.minioAccessKey,
    secretKey: config.minioSecretKey,
    region: config.minioRegion,
    pathStyle: true, // MinIO requires path-style access
  });
}

let _client: Minio.Client | null = null;
function client(): Minio.Client {
  if (!_client) _client = createMinioClient();
  return _client;
}

/**
 * Pre-signed upload URL (PUT) for MinIO. The MIME type is NOT bound into the signature (the
 * minio client does not sign PUT headers) — it is validated server-side at preflight against the
 * allowlist and re-derived from magic bytes during the AV scan→promote step, which is the
 * authoritative check.
 */
export function createSignedUploadUrl(
  bucket: string,
  key: string,
  ttlSeconds: number = config.uploadUrlTtlSeconds,
): Promise<string> {
  return client().presignedPutObject(bucket, key, ttlSeconds);
}

/** Pre-signed download URL (GET) for MinIO. */
export function createSignedDownloadUrl(
  bucket: string,
  key: string,
  ttlSeconds: number = config.downloadUrlTtlSeconds,
): Promise<string> {
  return client().presignedGetObject(bucket, key, ttlSeconds);
}

/**
 * Server-side object read as a Node stream (service-role). Used by the AV scan worker to stream
 * a quarantined object to clamd without buffering it. Throws if the object is absent.
 */
export function getObjectStream(bucket: string, key: string): Promise<Readable> {
  return client().getObject(bucket, key);
}

/**
 * ČÁST objektu — pro `Range` požadavky.
 *
 * ⛔ PROČ TO MUSÍ EXISTOVAT (naměřeno 2026-09-22): APK řidiče se z veřejné
 * adresy stahovalo rychlostí 50 kB/s a cesta ven má strop ~60 s na požadavek.
 * 52 MB tedy jedním stažením NEPROJDE — tablet balíček nedostal, i když
 * v úložišti ležel. Bez částečného čtení se to nedá rozdělit ani navázat.
 */
export function getObjectRange(
  bucket: string,
  key: string,
  od: number,
  delka: number,
): Promise<Readable> {
  return client().getPartialObject(bucket, key, od, delka);
}

/**
 * Server-side zápis proudu (nahrání přes API, APK hlídače). `size` je délka,
 * kterou klient ohlásil; volající proud omezí, aby jí nepřetekl.
 */
export async function putObjectStream(
  bucket: string,
  key: string,
  stream: Readable,
  size: number,
  meta: Record<string, string>,
): Promise<void> {
  await client().putObject(bucket, key, stream, size, meta);
}

/**
 * Založí bucket, pokud chybí. Pro bucket schopnosti „zařízení“: minio-init ho
 * nezakládá, protože jádrový compose je u stropu ARG_MAX (riq 34 993 / 35 000 B,
 * naměřeno 2026-09-19) — a bucket patří jen instanci, která schopnost zapnula.
 */
export async function zajistiBucket(bucket: string): Promise<void> {
  if (await client().bucketExists(bucket)) return;
  try {
    await client().makeBucket(bucket, config.minioRegion);
  } catch (err) {
    // Souběžný požadavek ho mohl založit mezi dotazem a založením.
    const code = (err as { code?: string }).code;
    if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw err;
  }
}

/** Jména objektů pod prefixem. Chybějící bucket = prázdný výpis, ne chyba. */
export async function vypisKlice(bucket: string, prefix: string): Promise<string[]> {
  if (!(await client().bucketExists(bucket))) return [];
  const klice: string[] = [];
  const proud = client().listObjectsV2(bucket, prefix, true);
  for await (const o of proud as AsyncIterable<{ name?: string }>) {
    if (o.name) klice.push(o.name);
  }
  return klice;
}

/** Metadata objektu, nebo null, když objekt (nebo celý bucket) neexistuje. */
export async function statObjectOrNull(
  bucket: string,
  key: string,
): Promise<{ size: number; lastModified: Date; metaData: Record<string, string> } | null> {
  try {
    const s = await client().statObject(bucket, key);
    return { size: s.size, lastModified: s.lastModified, metaData: s.metaData as Record<string, string> };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'NotFound' || code === 'NoSuchKey' || code === 'NoSuchBucket') return null;
    throw err;
  }
}

/**
 * Server-side copy (service-role). Promotes a clean object from the quarantine bucket to its
 * durable bucket. The source is `/<srcBucket>/<srcKey>` per the minio copy API.
 */
export async function copyObject(
  srcBucket: string,
  srcKey: string,
  dstBucket: string,
  dstKey: string,
): Promise<void> {
  await client().copyObject(dstBucket, dstKey, `/${srcBucket}/${srcKey}`);
}

/** Server-side delete (service-role). Removes the quarantine copy after promotion/block. */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  await client().removeObject(bucket, key);
}

/** Get public URL for objects in public buckets (via imgproxy or direct). */
export function getPublicUrl(bucket: string, key: string): string {
  // For images, route through imgproxy for WebP conversion + caching
  if (isImageKey(key)) {
    // imgproxy URL format: /insecure/rs:fit:800:0/plain/s3://{bucket}/{key}
    return `${config.imgproxyUrl}/insecure/plain/s3://${bucket}/${key}`;
  }
  // Non-image files served directly from MinIO (public bucket policy)
  return `${config.minioEndpoint}/${bucket}/${key}`;
}

function isImageKey(key: string): boolean {
  const ext = key.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(ext ?? '');
}
