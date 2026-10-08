/**
 * Správce obrázků editoru = galerie médií (2026-10-03, naměřeno na instanci).
 *
 * Dvojklik na obrázek (i obrázek pozadí ve stylech) otevírá GALERII, ne výchozí
 * správce GrapesJS, který znal jen obrázky předané při startu editoru — editor
 * webových stránek žádné. Výběr z galerie obrázek zaregistruje a dosadí
 * (`select(asset, true)` = dosadit a zavřít); zavření dialogu zavře správce.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Asset } from "grapesjs";

vi.mock("@/components/admin/media/GalerieMedii", () => ({
  GalerieMedii: ({ open, onOpenChange, onPick }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onPick: (url: string) => void;
  }) =>
    open ? (
      <div data-testid="galerie">
        <button onClick={() => onPick("https://api.example.test/storage/v1/object/public/page-assets/a.png")}>vybrat</button>
        <button onClick={() => onOpenChange(false)}>zavrit</button>
      </div>
    ) : null,
}));

import { MostGalerie } from "@/components/admin/page-builder/GalerieVEditoru";

const obrazek = { getSrc: () => "x" } as unknown as Asset;

describe("správce obrázků editoru = galerie médií", () => {
  it("zavřený správce galerii neukazuje", () => {
    render(<MostGalerie open={false} select={vi.fn()} close={vi.fn()} pridej={vi.fn()} />);
    expect(screen.queryByTestId("galerie")).toBeNull();
  });

  it("výběr zaregistruje adresu a dosadí ji se zavřením", () => {
    const select = vi.fn();
    const pridej = vi.fn(() => obrazek);
    render(<MostGalerie open select={select} close={vi.fn()} pridej={pridej} />);
    fireEvent.click(screen.getByText("vybrat"));
    expect(pridej).toHaveBeenCalledWith("https://api.example.test/storage/v1/object/public/page-assets/a.png");
    expect(select).toHaveBeenCalledWith(obrazek, true);
  });

  it("zavření dialogu zavře správce editoru", () => {
    const close = vi.fn();
    render(<MostGalerie open select={vi.fn()} close={close} pridej={vi.fn()} />);
    fireEvent.click(screen.getByText("zavrit"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("galerie je v editoru od prvního vykreslení a výchozí seznam z doby startu zmizel", () => {
    // AssetsProvider zapne `assetManager.custom` při připojení a editor tu volbu čte
    // jen při vzniku — galerie proto musí být uvnitř <GjsEditor> bez podmínky.
    const src = readFileSync(join(process.cwd(), "src/components/admin/page-builder/CanvasEditor.tsx"), "utf8");
    expect(src).toMatch(/<GjsEditor[\s\S]*<GalerieVEditoru \/>[\s\S]*<\/GjsEditor>/);
    expect(src).not.toMatch(/existingAssets/);
    expect(src).not.toMatch(/AssetManager\.add/);
  });
});
