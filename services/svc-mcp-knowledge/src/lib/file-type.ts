/**
 * Detect Ragnarok-compatible source_type from filename and content.
 *
 * Ragnarok upstream defaultuje source_type=PDF a saves uploaded content do
 * tmp souboru s `.{source_type}` suffix; mismatch vede k parser fail. Klienti
 * by neměli muset tento detail znát — server-side detection udržuje úložná
 * hranici jasná: client posílá raw file, my určíme typ.
 *
 * Strategy (in order):
 *   1. Explicit `provided` value if matches enum (klient může override)
 *   2. Filename extension (cheap; works pro 95% případů)
 *   3. Magic-byte sniff buffer prvních N bajtů
 *   4. Fallback: 'txt' (textový default; Ragnarok parse_txt zpracuje cokoliv)
 *
 * Supported types (Ragnarok common.models.enums.SourceType):
 *   docx, html, pdf, pptx, txt, xlsx
 *
 * Markdown (.md, .markdown) → 'txt' protože Ragnarok TextLoader handluje
 * plain markdown stejně jako txt (heading struktura zachovaná).
 */

export type RagnarokSourceType = 'docx' | 'html' | 'pdf' | 'pptx' | 'txt' | 'xlsx';

const SUPPORTED: ReadonlySet<RagnarokSourceType> = new Set([
  'docx', 'html', 'pdf', 'pptx', 'txt', 'xlsx',
]);

const EXTENSION_MAP: Record<string, RagnarokSourceType> = {
  pdf: 'pdf',
  docx: 'docx',
  html: 'html', htm: 'html',
  pptx: 'pptx',
  xlsx: 'xlsx',
  txt: 'txt',
  md: 'txt', markdown: 'txt',
};

function fromExtension(filename: string): RagnarokSourceType | null {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === filename.length - 1) return null;
  const ext = filename.slice(dotIdx + 1).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

function fromMagicBytes(buf: Buffer): RagnarokSourceType | null {
  if (buf.length < 4) return null;
  const first4 = buf.subarray(0, 4);
  // PDF: %PDF
  if (first4[0] === 0x25 && first4[1] === 0x50 && first4[2] === 0x44 && first4[3] === 0x46) {
    return 'pdf';
  }
  // ZIP-based formats (docx, pptx, xlsx): PK\x03\x04
  if (first4[0] === 0x50 && first4[1] === 0x4b && first4[2] === 0x03 && first4[3] === 0x04) {
    // We can't easily distinguish docx/pptx/xlsx from raw bytes without
    // unzipping; defer to extension when known, otherwise treat as docx
    // (most common in business uploads).
    return 'docx';
  }
  // HTML: <!DOCTYPE / <html / <HTML (common starts)
  const head = buf.subarray(0, Math.min(buf.length, 64)).toString('utf-8', 0, Math.min(buf.length, 64));
  if (/^\s*(<!doctype html|<html|<HTML)/i.test(head)) {
    return 'html';
  }
  return null;
}

export function detectSourceType(opts: {
  filename?: string;
  buffer?: Buffer;
  provided?: string;
}): RagnarokSourceType {
  const provided = opts.provided?.toLowerCase();
  if (provided && SUPPORTED.has(provided as RagnarokSourceType)) {
    return provided as RagnarokSourceType;
  }

  if (opts.filename) {
    const fromName = fromExtension(opts.filename);
    if (fromName) return fromName;
  }

  if (opts.buffer) {
    const fromMagic = fromMagicBytes(opts.buffer);
    if (fromMagic) return fromMagic;
  }

  return 'txt';
}
