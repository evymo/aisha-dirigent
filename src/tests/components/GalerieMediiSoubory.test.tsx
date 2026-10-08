/**
 * Galerie médií a soubory, které nejsou obrázek (2026-10-03, naměřeno na instanci).
 *
 * Do galerie se převzaly i dokumenty GDPR (PDF). Galerie vybírá obrázek
 * (editor, titulní obrázek článku): PDF se ukáže jako dlaždice s ikonou,
 * ale vybrat nejde — jinak by do <img> šlo PDF a náhled přes imgproxy by byl rozbitý.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@/hooks/useMediaAssets";

const media: MediaAsset[] = [
  { id: "1", bucket: "page-assets", object_key: "a/1_foto.jpg", content_type: "image/jpeg", bytes: 2048, original_name: "foto.jpg", uploaded_by: null, created_at: "2026-10-03T08:00:00Z" },
  { id: "2", bucket: "page-assets", object_key: "a/2_GDPR.pdf", content_type: "application/pdf", bytes: 4096, original_name: "GDPR.pdf", uploaded_by: null, created_at: "2026-10-03T08:00:00Z" },
];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k) }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useMediaAssets", () => ({
  useMediaAssets: () => ({ data: media, isLoading: false }),
  useDeleteMediaAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvalidateMediaAssets: () => vi.fn(),
  verejnaAdresaMedia: (m: MediaAsset) => `https://api.example.test/storage/v1/object/public/${m.bucket}/${m.object_key}`,
}));
vi.mock("@/hooks/usePageAssetUpload", () => ({
  ALLOWED_ASSET_TYPES: new Set(["image/jpeg"]),
  MAX_ASSET_BYTES: 1024,
  usePageAssetUpload: () => ({ uploadAsset: vi.fn() }),
}));
vi.mock("@/components/admin/media/NahravaciPole", () => ({ NahravaciPole: () => null }));

import { GalerieMedii } from "@/components/admin/media/GalerieMedii";

describe("galerie médií — soubory, které nejsou obrázek", () => {
  it("obrázek jde vybrat, PDF ne (a nemá náhled přes imgproxy)", () => {
    const onPick = vi.fn();
    render(<GalerieMedii open onOpenChange={vi.fn()} onPick={onPick} />);

    const foto = screen.getByTitle("foto.jpg");
    const pdf = screen.getByTitle("admin.media.notImage:GDPR.pdf");
    expect(foto).toBeEnabled();
    expect(pdf).toBeDisabled();
    expect(pdf.querySelector("img")).toBeNull();

    fireEvent.click(pdf);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(foto);
    expect(onPick).toHaveBeenCalledWith(
      "https://api.example.test/storage/v1/object/public/page-assets/a/1_foto.jpg",
      media[0],
    );
  });
});
