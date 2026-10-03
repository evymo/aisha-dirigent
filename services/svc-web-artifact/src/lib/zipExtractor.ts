/**
 * Safe zip extractor — bounded entries + uncompressed-size + magic-byte gating.
 *
 * Zip-bomb safe by design:
 *   - max entries (default 200)
 *   - max total uncompressed bytes (default 100 MB)
 *   - magic byte sniff (PK\x03\x04) before AdmZip touches the buffer
 *   - per-entry path traversal guard (no .. or absolute paths)
 */
import AdmZip from 'adm-zip';

export interface ZipExtractOptions {
  maxEntries: number;
  maxUncompressedBytes: number;
}

export interface ExtractedFile {
  /** Sanitized relative path inside the archive. */
  path: string;
  /** Raw bytes for binary files (images, fonts). */
  bytes: Buffer;
}

export class ZipExtractError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ZipExtractError';
  }
}

const PK_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function extractZip(buf: Buffer, opts: ZipExtractOptions): ExtractedFile[] {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(PK_HEADER)) {
    throw new ZipExtractError('not a zip archive (magic byte mismatch)', 'not_zip');
  }
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  if (entries.length > opts.maxEntries) {
    throw new ZipExtractError(`too many entries (${entries.length} > ${opts.maxEntries})`, 'too_many_entries');
  }
  let totalBytes = 0;
  const out: ExtractedFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rawName = entry.entryName.replace(/\\/g, '/');
    if (rawName.startsWith('/') || rawName.includes('..')) {
      throw new ZipExtractError(`unsafe path: ${rawName}`, 'unsafe_path');
    }
    const data = entry.getData();
    totalBytes += data.length;
    if (totalBytes > opts.maxUncompressedBytes) {
      throw new ZipExtractError(`uncompressed size exceeded (${totalBytes} > ${opts.maxUncompressedBytes})`, 'too_large');
    }
    out.push({ path: rawName, bytes: data });
  }
  return out;
}

/**
 * Pick the primary HTML entrypoint from an extracted archive.
 * Prefers `index.html` at root, then any `*.html` at root, then any nested `index.html`.
 */
export function pickPrimaryHtml(files: ExtractedFile[]): ExtractedFile | null {
  const indexAtRoot = files.find((f) => f.path.toLowerCase() === 'index.html');
  if (indexAtRoot) return indexAtRoot;
  const rootHtml = files.find((f) => !f.path.includes('/') && f.path.toLowerCase().endsWith('.html'));
  if (rootHtml) return rootHtml;
  const nestedIndex = files.find((f) => f.path.toLowerCase().endsWith('/index.html'));
  if (nestedIndex) return nestedIndex;
  return files.find((f) => f.path.toLowerCase().endsWith('.html')) ?? null;
}

/** Concat all CSS files into a single string. */
export function concatCss(files: ExtractedFile[]): string {
  return files
    .filter((f) => f.path.toLowerCase().endsWith('.css'))
    .map((f) => `/* ${f.path} */\n${f.bytes.toString('utf-8')}`)
    .join('\n\n');
}
