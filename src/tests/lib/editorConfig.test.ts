import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AssetUploadHandler,
  type EditorBrandingTokens,
  getPageEditorConfig,
} from "@/lib/builder/editorConfig";

interface StyleProperty {
  property?: string;
  options?: Array<{ id: string; label: string }>;
}

interface StyleSector {
  name?: string;
  properties?: StyleProperty[];
}

interface StyleManagerShape {
  sectors?: StyleSector[];
}

interface DeviceManagerShape {
  devices?: Array<{ name: string; width: string; widthMedia?: string }>;
}

interface AssetManagerShape {
  uploadFile?: (
    event: DataTransfer | Event,
    clb?: (result: { data: string[] }) => void,
  ) => Promise<void>;
  autoAdd?: boolean;
}

function getStyleManager(config: ReturnType<typeof getPageEditorConfig>): StyleManagerShape {
  return config.styleManager as StyleManagerShape;
}

function getDeviceManager(config: ReturnType<typeof getPageEditorConfig>): DeviceManagerShape {
  return config.deviceManager as DeviceManagerShape;
}

function getAssetManager(config: ReturnType<typeof getPageEditorConfig>): AssetManagerShape {
  return config.assetManager as AssetManagerShape;
}

describe("getPageEditorConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds default editor controls and canvas tokens", () => {
    const config = getPageEditorConfig();
    const sectors = getStyleManager(config).sectors ?? [];

    expect(config.height).toBe("100%");
    expect(config.storageManager).toBe(false);
    expect(sectors.map((sector) => sector.name)).toEqual([
      "Layout",
      "Dimension",
      "Typography",
      "Background",
      "Borders",
      "Effects",
    ]);
    expect(config.canvasCss).toContain("--sc-brand: #FF6A1A");
    expect(config.canvasCss).toContain("font-family: Nunito Sans, sans-serif");
  });

  it("uses branding font tokens in typography options and canvas CSS", () => {
    const brandingTokens: EditorBrandingTokens = {
      font_family_body: "'Inter', sans-serif",
      font_family_brand: "'Aisha Display', sans-serif",
      font_family_code: "'IBM Plex Mono', monospace",
    };

    const config = getPageEditorConfig(brandingTokens);
    const typography = (getStyleManager(config).sectors ?? []).find(
      (sector) => sector.name === "Typography",
    );
    const fontFamily = (typography?.properties ?? []).find(
      (property) => property.property === "font-family",
    );

    expect(fontFamily?.options).toEqual(
      expect.arrayContaining([
        { id: "'Aisha Display', sans-serif", label: "Aisha Display" },
        { id: "'Inter', sans-serif", label: "Inter" },
        { id: "'IBM Plex Mono', monospace", label: "IBM Plex Mono" },
        { id: "system-ui, sans-serif", label: "System UI" },
      ]),
    );
    expect(config.canvasCss).toContain("font-family: 'Inter', sans-serif");
  });

  it("deduplicates repeated brand and body font stacks", () => {
    const config = getPageEditorConfig({
      font_family_body: "Nunito Sans, sans-serif",
      font_family_brand: "Nunito Sans, sans-serif",
      font_family_code: "JetBrains Mono, monospace",
    });
    const typography = (getStyleManager(config).sectors ?? []).find(
      (sector) => sector.name === "Typography",
    );
    const fontFamily = (typography?.properties ?? []).find(
      (property) => property.property === "font-family",
    );

    const brandFontOptions = (fontFamily?.options ?? []).filter(
      (option) => option.id === "Nunito Sans, sans-serif",
    );
    expect(brandFontOptions).toHaveLength(1);
  });

  it("configures device presets and applies caller overrides", () => {
    const config = getPageEditorConfig(undefined, undefined, {
      height: "640px",
      storageManager: { type: "remote" },
    });
    const devices = getDeviceManager(config).devices ?? [];

    expect(config.height).toBe("640px");
    expect(config.storageManager).toEqual({ type: "remote" });
    expect(devices).toEqual([
      { name: "Desktop", width: "" },
      { name: "Tablet", width: "768px", widthMedia: "992px" },
      { name: "Mobile", width: "375px", widthMedia: "480px" },
    ]);
  });

  it("uploads dropped assets through the provided handler", async () => {
    class TestDataTransfer {
      files: File[];

      constructor(files: File[]) {
        this.files = files;
      }
    }

    vi.stubGlobal("DataTransfer", TestDataTransfer);

    const uploadHandler: AssetUploadHandler = vi.fn(async (file) => `/assets/${file.name}`);
    const config = getPageEditorConfig(undefined, uploadHandler);
    const uploadFile = getAssetManager(config).uploadFile;

    expect(typeof uploadFile).toBe("function");

    // A GrapesJS drop delivers files via the DragEvent's `dataTransfer`.
    const event = {
      dataTransfer: new TestDataTransfer([
        new File(["a"], "first.txt", { type: "text/plain" }),
        new File(["b"], "second.txt", { type: "text/plain" }),
      ]),
    } as unknown as DragEvent;

    // GrapesJS consumes uploaded assets via the callback; uploadFile returns void.
    const clb = vi.fn();
    await uploadFile?.(event, clb);
    expect(clb).toHaveBeenCalledWith({
      data: ["/assets/first.txt", "/assets/second.txt"],
    });
    expect(uploadHandler).toHaveBeenCalledTimes(2);
  });

  it("uploads file input assets and leaves upload undefined without a handler", async () => {
    const uploadHandler: AssetUploadHandler = vi.fn(async (file) => `/assets/${file.name}`);
    const config = getPageEditorConfig(undefined, uploadHandler);
    const uploadFile = getAssetManager(config).uploadFile;
    const input = document.createElement("input");
    const file = new File(["content"], "input.txt", { type: "text/plain" });

    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });

    const inputEvent = new Event("change", { bubbles: true });
    Object.defineProperty(inputEvent, "target", {
      value: input,
      configurable: true,
    });

    const clb = vi.fn();
    await uploadFile?.(inputEvent, clb);
    expect(clb).toHaveBeenCalledWith({ data: ["/assets/input.txt"] });
    expect(getAssetManager(getPageEditorConfig()).uploadFile).toBeUndefined();
  });

  // ⛔ NAPSÁNO ČERVENÉ proti výchozímu nastavení (naměřeno 2026-09-03 headless
  // GrapesJS 0.22.16, audit U5-1): bez `keepUnusedStyles` vydá getCss() jen
  // pravidla se selektorem na plátně. Útržky nav/footer jsou v plátně prázdné
  // <div data-partial>, takže .nav*, .foot*, h1–h4, .prose při uložení
  // zmizely — index.canvas_css 27 032 B → 9 777 B, 34 selektorů pryč.
  it("drží i CSS pravidla bez selektoru na plátně — sdílené CSS webu patří stránce celé", () => {
    const config = getPageEditorConfig();

    expect(config.keepUnusedStyles).toBe(true);
  });

  it("explicitní přepis keepUnusedStyles má přednost — ale musí být vědomý", () => {
    const config = getPageEditorConfig(undefined, undefined, { keepUnusedStyles: false });

    expect(config.keepUnusedStyles).toBe(false);
  });
});
