import { MAX_SIGNATURE_BYTES, fitsSignatureLimit, strokesToDataUri } from "@/lib/signature";

describe("strokesToDataUri", () => {
  it("produces what the evidence contract demands — an image data URI", () => {
    const uri = strokesToDataUri(["M 10 10 L 20 20"], 300, 180);
    // The RPC's check is literally `not like 'data:image/%'` → raise.
    expect(uri).toMatch(/^data:image\//);
  });

  it("is null when nothing was drawn, so an empty pad cannot pass as a signature", () => {
    expect(strokesToDataUri([], 300, 180)).toBeNull();
    expect(strokesToDataUri(["", "   "], 300, 180)).toBeNull();
  });

  it("keeps a realistic signature far under the server ceiling", () => {
    // ~40 strokes of ~50 points each is a florid signature; vector stays tiny.
    const strokes = Array.from({ length: 40 }, (_, s) =>
      Array.from({ length: 50 }, (_, i) => `${i === 0 ? "M" : "L"} ${s + i}.5 ${i * 2}.5`).join(" "),
    );
    const uri = strokesToDataUri(strokes, 320, 180)!;
    expect(fitsSignatureLimit(uri)).toBe(true);
    expect(uri.length).toBeLessThan(MAX_SIGNATURE_BYTES / 4);
  });

  it("percent-encodes, so the markup cannot break out of the URI", () => {
    const uri = strokesToDataUri(["M 0 0 L 1 1"], 10, 10)!;
    expect(uri).not.toContain("<");
    expect(uri).not.toContain('"');
    expect(uri).toContain("%3Csvg");
  });

  it("survives a degenerate canvas size instead of emitting viewBox 0 0", () => {
    const uri = strokesToDataUri(["M 0 0 L 1 1"], 0, 0)!;
    expect(decodeURIComponent(uri)).toContain("viewBox=\"0 0 1 1\"");
  });

  it("draws every stroke it was given", () => {
    const svg = decodeURIComponent(strokesToDataUri(["M 0 0", "M 5 5", "M 9 9"], 50, 50)!);
    expect(svg.match(/<path /g)).toHaveLength(3);
  });
});

describe("fitsSignatureLimit", () => {
  it("refuses at the same number the server refuses at", () => {
    expect(fitsSignatureLimit("x".repeat(MAX_SIGNATURE_BYTES))).toBe(true);
    expect(fitsSignatureLimit("x".repeat(MAX_SIGNATURE_BYTES + 1))).toBe(false);
  });
});
