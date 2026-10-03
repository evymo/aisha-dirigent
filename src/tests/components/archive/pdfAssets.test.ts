import { describe, expect, it, vi } from "vitest";
import {
  areLocalPdfAssetsReachable,
  buildPdfDocumentOptions,
  parsePdfAssetMode,
  resolvePdfAssetMode,
} from "@/components/archive/pdfAssets";

describe("pdfAssets", () => {
  it("parses supported asset mode values", () => {
    expect(parsePdfAssetMode("auto")).toBe("auto");
    expect(parsePdfAssetMode("LOCAL")).toBe("local");
    expect(parsePdfAssetMode("cdn")).toBe("cdn");
    expect(parsePdfAssetMode("invalid")).toBeNull();
    expect(parsePdfAssetMode("")).toBeNull();
  });

  it("resolves mode with query/env priority", () => {
    expect(
      resolvePdfAssetMode({
        queryString: "?pdfjsAssets=cdn",
        envMode: "local",
      })
    ).toBe("cdn");

    expect(
      resolvePdfAssetMode({
        queryString: "?pdfjsAssets=invalid",
        envMode: "local",
      })
    ).toBe("local");

    expect(resolvePdfAssetMode({})).toBe("auto");
  });

  it("builds options for local and CDN sources", () => {
    const localOptions = buildPdfDocumentOptions("local", "5.4.296");
    expect(localOptions.cMapUrl).toBe("/pdfjs/cmaps/");
    expect(localOptions.standardFontDataUrl).toBe("/pdfjs/standard_fonts/");
    expect(localOptions.cMapPacked).toBe(true);
    expect(localOptions.disableFontFace).toBe(true);

    const cdnOptions = buildPdfDocumentOptions("cdn", "5.4.296");
    expect(cdnOptions.cMapUrl).toBe("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/cmaps/");
    expect(cdnOptions.standardFontDataUrl).toBe(
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/standard_fonts/"
    );
    expect(cdnOptions.cMapPacked).toBe(true);
    expect(cdnOptions.disableFontFace).toBe(true);
  });

  it("returns true when both local probe assets are reachable", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true } as Response));

    const result = await areLocalPdfAssetsReachable(fetchMock as unknown as typeof fetch);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns false when any local probe asset is not reachable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("LiberationSans-Regular.ttf")) {
        return { ok: false } as Response;
      }
      return { ok: true } as Response;
    });

    const result = await areLocalPdfAssetsReachable(fetchMock as unknown as typeof fetch);

    expect(result).toBe(false);
  });
});
