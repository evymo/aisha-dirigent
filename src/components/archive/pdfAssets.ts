export type PdfAssetSource = "local" | "cdn";
export type PdfAssetMode = PdfAssetSource | "auto";

const PDF_ASSET_QUERY_PARAM = "pdfjsAssets";
const LOCAL_ASSET_PROBES = [
  "/pdfjs/cmaps/Identity-H.bcmap",
  "/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
] as const;

/**
 * Parses a PDF.js asset mode value.
 */
export function parsePdfAssetMode(value?: string | null): PdfAssetMode | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "local" || normalized === "cdn") {
    return normalized;
  }

  return null;
}

/**
 * Resolves PDF.js asset mode with priority:
 * 1) URL query param (?pdfjsAssets=auto|local|cdn)
 * 2) VITE_PDFJS_ASSETS_MODE
 * 3) Default auto
 */
export function resolvePdfAssetMode({
  queryString,
  envMode,
}: {
  queryString?: string | null;
  envMode?: string | null;
}): PdfAssetMode {
  const queryMode = parsePdfAssetMode(new URLSearchParams(queryString ?? "").get(PDF_ASSET_QUERY_PARAM));
  if (queryMode) return queryMode;

  const explicitEnvMode = parsePdfAssetMode(envMode);
  if (explicitEnvMode) return explicitEnvMode;

  return "auto";
}

/**
 * Builds react-pdf Document options for a selected asset source.
 */
export function buildPdfDocumentOptions(source: PdfAssetSource, pdfjsVersion: string) {
  const base = {
    cMapPacked: true,
    /**
     * Render font glyphs as canvas path commands instead of loading embedded
     * fonts via @font-face. This avoids browser font-metric mismatches that
     * cause overlapping / garbled characters — especially with custom or
     * Type 1 heading fonts common in older Czech PDFs.
     */
    disableFontFace: true,
  };

  if (source === "cdn") {
    return {
      ...base,
      cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion}/cmaps/`,
      standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion}/standard_fonts/`,
    };
  }

  return {
    ...base,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  };
}

async function isAssetReachable(fetchImpl: typeof fetch, url: string): Promise<boolean> {
  try {
    const headResponse = await fetchImpl(url, { method: "HEAD", cache: "no-store" });
    if (headResponse.ok) return true;
  } catch {
    // Continue with GET fallback for servers that do not support HEAD.
  }

  try {
    const getResponse = await fetchImpl(url, { method: "GET", cache: "no-store" });
    return getResponse.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort reachability probe for local PDF.js font and cmap assets.
 */
export async function areLocalPdfAssetsReachable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const results = await Promise.all(
    LOCAL_ASSET_PROBES.map((assetUrl) => isAssetReachable(fetchImpl, assetUrl))
  );

  return results.every(Boolean);
}
