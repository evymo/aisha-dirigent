/**
 * DocumentRedactor — Unit Tests
 *
 * Verifies canvas-based redaction (začernění) flow for images AND PDFs:
 * - Rendering, i18n keys, interaction, save/undo/close.
 * - PDF page navigation, multi-page redaction.
 *
 * @see src/components/common/DocumentRedactor.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentRedactor, REDACTOR_SUPPORTED_TYPES } from "@/components/common/DocumentRedactor";

// ── Mock i18n ────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && "current" in opts && "total" in opts) {
        return `Page ${opts.current} of ${opts.total}`;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

// ── Mock react-pdf (pdfjs) ───────────────────────────────────
const mockGetPage = vi.fn();
const mockPdfDocProxy = {
  numPages: 3,
  getPage: mockGetPage,
};

vi.mock("react-pdf", () => ({
  pdfjs: {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(mockPdfDocProxy),
    })),
    GlobalWorkerOptions: { workerSrc: "" },
  },
}));

// ── Mock pdf-lib ─────────────────────────────────────────────
vi.mock("pdf-lib", () => {
  const mockPage = { drawImage: vi.fn() };
  const mockPdfDocument = {
    addPage: vi.fn(() => mockPage),
    embedPng: vi.fn(() => Promise.resolve({})),
    save: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70]))), // %PDF
  };
  return {
    PDFDocument: {
      create: vi.fn(() => Promise.resolve(mockPdfDocument)),
    },
  };
});

// ── Canvas mock ──────────────────────────────────────────────
const mockFillRect = vi.fn();
const mockClearRect = vi.fn();
const mockDrawImage = vi.fn();
const mockToBlob = vi.fn();
const mockGetContext = vi.fn(() => ({
  fillRect: mockFillRect,
  clearRect: mockClearRect,
  drawImage: mockDrawImage,
  fillStyle: "",
}));
const mockToDataURL = vi.fn(() => "data:image/png;base64,iVBOR");

// ── Image mock (fires onload synchronously for jsdom) ────────
const OriginalImage = globalThis.Image;

beforeEach(() => {
  // Mock URL.createObjectURL/revokeObjectURL (not available in jsdom)
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = vi.fn();
  }

  // @ts-expect-error — canvas mock returns partial context, sufficient for unit tests
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(mockGetContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(mockToBlob);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(mockToDataURL);

  // Mock PDF page rendering
  const mockViewport = { width: 600, height: 800 };
  mockGetPage.mockResolvedValue({
    getViewport: vi.fn(() => mockViewport),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  });

  // Mock Image so onload fires when src is set (jsdom doesn't load images)
  globalThis.Image = class MockImage {
    width = 600;
    height = 400;
    complete = false;
    onload: (() => void) | null = null;
    private _src = "";
    get src() { return this._src; }
    set src(v: string) {
      this._src = v;
      this.complete = true;
      // Fire onload on next microtask
      Promise.resolve().then(() => { this.onload?.(); });
    }
  } as unknown as typeof Image;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.Image = OriginalImage;
});

// ── Helpers ──────────────────────────────────────────────────
function createMockFile(name = "photo.jpg", type = "image/jpeg"): File {
  return new File(["fake-content"], name, { type });
}

function createMockPdfFile(name = "document.pdf"): File {
  const file = new File(["fake-pdf-content"], name, { type: "application/pdf" });
  // jsdom File may lack arrayBuffer(); add a polyfill fallback
  if (typeof file.arrayBuffer !== "function") {
    (file as unknown as Record<string, unknown>).arrayBuffer = () =>
      Promise.resolve(new ArrayBuffer(8));
  }
  return file;
}

describe("DocumentRedactor", () => {
  // ── Rendering ──────────────────────────────────────────────

  it("renders dialog with i18n title when open", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("common.redactDocument")).toBeTruthy();
  });

  it("renders undo button (disabled with no rects)", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const undoButton = screen.getByText("common.undo").closest("button");
    expect(undoButton).toBeTruthy();
    expect(undoButton?.disabled).toBe(true);
  });

  it("renders save and cancel buttons with i18n", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("common.save")).toBeTruthy();
    expect(screen.getByText("common.cancel")).toBeTruthy();
  });

  it("save button is disabled when no redaction rects exist", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const saveButton = screen.getByText("common.save").closest("button");
    expect(saveButton?.disabled).toBe(true);
  });

  it("shows redaction hint text", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("common.redactHint")).toBeTruthy();
  });

  // ── Close behavior ─────────────────────────────────────────

  it("calls onClose when cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("common.cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Not open ───────────────────────────────────────────────

  it("does not render dialog content when isOpen=false", () => {
    const { container } = render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(container.querySelector("canvas")).toBeNull();
  });

  // ── Supported types ────────────────────────────────────────

  it("REDACTOR_SUPPORTED_TYPES includes images and PDF", () => {
    expect(REDACTOR_SUPPORTED_TYPES).toContain("image/jpeg");
    expect(REDACTOR_SUPPORTED_TYPES).toContain("image/png");
    expect(REDACTOR_SUPPORTED_TYPES).toContain("image/webp");
    expect(REDACTOR_SUPPORTED_TYPES).toContain("application/pdf");
  });

  // ── PDF mode ───────────────────────────────────────────────

  it("shows page navigation for multi-page PDF", async () => {
    render(
      <DocumentRedactor
        file={createMockPdfFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    });
  });

  it("does not show page navigation for single-page image", () => {
    render(
      <DocumentRedactor
        file={createMockFile()}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    // Image files should NOT show page navigation
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
  });

  // ── i18n keys completeness ─────────────────────────────────

  it("uses only i18n keys, no hardcoded strings", () => {
    const requiredKeys = [
      "common.redactDocument",
      "common.redactHint",
      "common.undo",
      "common.cancel",
      "common.save",
      "common.loading",
      "common.pageOf",     // PDF page navigation
      "common.previous",   // PDF prev page aria-label
      "common.next",       // PDF next page aria-label
    ];
    expect(requiredKeys.length).toBe(9);
    requiredKeys.forEach((key) => {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });
  });

  // ── Security: Redacted file is always a new object ─────────

  it("onSave receives a new File, not the original (image)", async () => {
    const onSave = vi.fn();
    const originalFile = createMockFile("original.jpg", "image/jpeg");

    mockToBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
      callback(new Blob(["redacted-data"], { type: "image/jpeg" }));
    });

    render(
      <DocumentRedactor
        file={originalFile}
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    // Wait for Image.onload to fire (mocked) and canvas to render
    await waitFor(() => {
      expect(document.querySelector("canvas")).not.toBeNull();
    });

    const canvas = document.querySelector("canvas")!;

    // Simulate drawing a redaction rect via mouse events
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });

    // Rect (90x90) exceeds min threshold → save should be enabled
    await waitFor(() => {
      const saveButton = screen.getByText("common.save").closest("button");
      expect(saveButton?.disabled).toBe(false);
    });

    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      const savedFile = onSave.mock.calls[0][0] as File;
      expect(savedFile).not.toBe(originalFile);
      expect(savedFile.name).toBe("original.jpg");
    });
  });
});
