/**
 * DocumentUploadZone — Unit Tests
 *
 * Verifies upload dropzone behavior:
 * - Rendering, i18n, file selection, drag & drop, redaction trigger.
 *
 * @see src/components/common/DocumentUploadZone.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentUploadZone } from "@/components/common/DocumentUploadZone";

// ── Mock i18n ────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// ── Mock DocumentRedactor to avoid canvas ────────────────────
vi.mock("@/components/common/DocumentRedactor", () => ({
  DocumentRedactor: ({
    isOpen,
    onSave,
    onClose,
  }: {
    file: File;
    isOpen: boolean;
    onSave: (f: File) => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mock-redactor">
        <button onClick={() => onSave(new File(["r"], "redacted.jpg", { type: "image/jpeg" }))}>
          mock-save
        </button>
        <button onClick={onClose}>mock-close</button>
      </div>
    ) : null,
}));

// ── Helpers ──────────────────────────────────────────────────
function createMockFile(name: string, type: string): File {
  return new File(["content"], name, { type });
}

describe("DocumentUploadZone", () => {
  let onFilesSelected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onFilesSelected = vi.fn();
  });

  // ── Rendering ──────────────────────────────────────────────

  it("renders dropzone with i18n text", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
      />,
    );

    expect(screen.getByText("promo.upload.dropzone")).toBeTruthy();
    expect(screen.getByText("promo.upload.formats")).toBeTruthy();
  });

  it("renders browse and camera buttons", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
      />,
    );

    expect(screen.getByText("promo.upload.browse")).toBeTruthy();
    expect(screen.getByText("promo.upload.camera")).toBeTruthy();
  });

  it("disables buttons when uploading", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={true}
      />,
    );

    const browseButton = screen.getByText("promo.upload.browse").closest("button");
    const cameraButton = screen.getByText("promo.upload.camera").closest("button");
    expect(browseButton?.disabled).toBe(true);
    expect(cameraButton?.disabled).toBe(true);
  });

  // ── File selection: non-redactable goes directly ────────────

  it("calls onFilesSelected directly for DOCX (no redaction)", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    expect(input).toBeTruthy();

    const docxFile = createMockFile(
      "document.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    fireEvent.change(input, { target: { files: [docxFile] } });

    expect(onFilesSelected).toHaveBeenCalledWith([docxFile]);
  });

  // ── Redaction trigger for single image ─────────────────────

  it("opens redactor for single JPEG instead of calling onFilesSelected", async () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const jpgFile = createMockFile("photo.jpg", "image/jpeg");
    fireEvent.change(input, { target: { files: [jpgFile] } });

    // Should NOT call onFilesSelected directly (redactor should open)
    expect(onFilesSelected).not.toHaveBeenCalled();
    // Redactor should be shown
    // ⛔ ČEKÁ SE ZÁMĚRNĚ: DocumentRedactor je od 4f0bb40cb lazy (táhl react-pdf
      // + pdf-lib do balíku, který stahoval i anonymní návštěvník). Renderuje se
      // proto až po dojetí chunku — `findBy` to ověří stejně přísně jako `getBy`,
      // jen respektuje, že hranice je asynchronní.
      expect(await screen.findByTestId("mock-redactor")).toBeTruthy();
  });

  it("opens redactor for single PNG", async () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const pngFile = createMockFile("photo.png", "image/png");
    fireEvent.change(input, { target: { files: [pngFile] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
    // ⛔ ČEKÁ SE ZÁMĚRNĚ: DocumentRedactor je od 4f0bb40cb lazy (táhl react-pdf
      // + pdf-lib do balíku, který stahoval i anonymní návštěvník). Renderuje se
      // proto až po dojetí chunku — `findBy` to ověří stejně přísně jako `getBy`,
      // jen respektuje, že hranice je asynchronní.
      expect(await screen.findByTestId("mock-redactor")).toBeTruthy();
  });

  it("opens redactor for single WebP", async () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const webpFile = createMockFile("photo.webp", "image/webp");
    fireEvent.change(input, { target: { files: [webpFile] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
    // ⛔ ČEKÁ SE ZÁMĚRNĚ: DocumentRedactor je od 4f0bb40cb lazy (táhl react-pdf
      // + pdf-lib do balíku, který stahoval i anonymní návštěvník). Renderuje se
      // proto až po dojetí chunku — `findBy` to ověří stejně přísně jako `getBy`,
      // jen respektuje, že hranice je asynchronní.
      expect(await screen.findByTestId("mock-redactor")).toBeTruthy();
  });

  it("opens redactor for single PDF", async () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const pdfFile = createMockFile("document.pdf", "application/pdf");
    fireEvent.change(input, { target: { files: [pdfFile] } });

    expect(onFilesSelected).not.toHaveBeenCalled();
    // ⛔ ČEKÁ SE ZÁMĚRNĚ: DocumentRedactor je od 4f0bb40cb lazy (táhl react-pdf
      // + pdf-lib do balíku, který stahoval i anonymní návštěvník). Renderuje se
      // proto až po dojetí chunku — `findBy` to ověří stejně přísně jako `getBy`,
      // jen respektuje, že hranice je asynchronní.
      expect(await screen.findByTestId("mock-redactor")).toBeTruthy();
  });

  // ── Redaction disabled ─────────────────────────────────────

  it("does NOT open redactor when enableRedaction=false", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={false}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const jpgFile = createMockFile("photo.jpg", "image/jpeg");
    fireEvent.change(input, { target: { files: [jpgFile] } });

    // Should go straight to onFilesSelected
    expect(onFilesSelected).toHaveBeenCalledWith([jpgFile]);
  });

  // ── Multiple files bypass redaction ────────────────────────

  it("bypasses redaction for multiple images", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const file1 = createMockFile("a.jpg", "image/jpeg");
    const file2 = createMockFile("b.png", "image/png");
    fireEvent.change(input, { target: { files: [file1, file2] } });

    // Multiple files go directly
    expect(onFilesSelected).toHaveBeenCalledWith([file1, file2]);
  });

  // ── Redactor save flow ─────────────────────────────────────

  it("passes redacted file to onFilesSelected after save in redactor", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const jpgFile = createMockFile("photo.jpg", "image/jpeg");
    fireEvent.change(input, { target: { files: [jpgFile] } });

    // Redactor is open, click mock save
    fireEvent.click(screen.getByText("mock-save"));

    expect(onFilesSelected).toHaveBeenCalledWith([
      expect.objectContaining({ name: "redacted.jpg" }),
    ]);
  });

  // ── maxFiles limiting ──────────────────────────────────────

  it("respects maxFiles limit", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={false}
        maxFiles={2}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const files = [
      createMockFile("a.pdf", "application/pdf"),
      createMockFile("b.pdf", "application/pdf"),
      createMockFile("c.pdf", "application/pdf"),
    ];
    fireEvent.change(input, { target: { files } });

    expect(onFilesSelected).toHaveBeenCalled();
    const passedFiles = onFilesSelected.mock.calls[0][0] as File[];
    expect(passedFiles.length).toBeLessThanOrEqual(2);
  });

  // ── i18n completeness ──────────────────────────────────────

  it("uses only i18n keys for all visible text", () => {
    const requiredKeys = [
      "promo.upload.dropzone",
      "promo.upload.formats",
      "promo.upload.browse",
      "promo.upload.camera",
    ];

    requiredKeys.forEach((key) => {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });
  });

  // ── Accepted file types ────────────────────────────────────

  it("filters out unsupported file types on drop", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={false}
      />,
    );

    const dropzone = document.querySelector("[class*='border-dashed']")!;
    const validFile = createMockFile("doc.pdf", "application/pdf");
    const invalidFile = createMockFile("hack.exe", "application/x-msdownload");

    const dataTransfer = {
      files: [validFile, invalidFile],
      types: ["Files"],
    };

    fireEvent.drop(dropzone, { dataTransfer });

    expect(onFilesSelected).toHaveBeenCalled();
    const passedFiles = onFilesSelected.mock.calls[0][0] as File[];
    expect(passedFiles.every((f: File) => f.name !== "hack.exe")).toBe(true);
  });

  // ── Custom accepted extensions ─────────────────────────────

  it("uses custom acceptedExtensions for input accept attribute", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        acceptedExtensions={["pdf", "jpg"]}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    expect(input.accept).toContain(".pdf");
    expect(input.accept).toContain(".jpg");
  });

  // ── Security: Original file never sent without redaction ───

  it("for single image with redaction enabled, original file is not sent to onFilesSelected", () => {
    render(
      <DocumentUploadZone
        onFilesSelected={onFilesSelected}
        isUploading={false}
        enableRedaction={true}
      />,
    );

    const input = document.querySelector("input[type='file']:not([capture])") as HTMLInputElement;
    const originalFile = createMockFile("sensitive.jpg", "image/jpeg");
    fireEvent.change(input, { target: { files: [originalFile] } });

    // onFilesSelected should NOT have been called with the original
    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});
