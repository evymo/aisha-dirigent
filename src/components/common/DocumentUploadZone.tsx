/**
 * Dropzóna pro nahrávání dokumentů.
 *
 * Podporuje drag & drop, výběr souborů a fotoaparát.
 *
 * @module components/common/DocumentUploadZone
 */

import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileText, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// ⛔ STATICKY NE: DocumentRedactor táhne react-pdf + pdf-lib (647 kB chunk),
// a protože leží v components/common/, padal spolu s ním do `shared` — tedy
// do balíku, který stahuje i anonymní návštěvník landing page, jenž nikdy
// žádné PDF neredigoval. Renderuje se přitom jen podmíněně (`fileToRedact &&`),
// takže lazy hranice tu byla vždycky — jen nebyla vyznačená.
// Naměřeno 2026-08-30: tenhle jediný import držel vendor-pdf v eager sadě.
const DocumentRedactor = lazy(() =>
  import("./DocumentRedactor").then((m) => ({ default: m.DocumentRedactor })),
);

/**
 * Props pro DocumentUploadZone komponentu.
 */
export interface DocumentUploadZoneProps {
  /** Callback volaný po výběru souborů */
  onFilesSelected: (files: File[]) => void;
  /** Indikátor probíhajícího uploadu */
  isUploading: boolean;
  /** Povolené přípony bez tečky, např. ["pdf", "jpg"] */
  acceptedExtensions?: string[];
  /** Maximální počet souborů na jeden výběr */
  maxFiles?: number;
  /** Další CSS třídy */
  className?: string;
  /** Povolit redakci (začernění) */
  enableRedaction?: boolean;
}

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

const DEFAULT_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
];

const REDACTABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/**
 * Dropzóna pro nahrávání dokumentů.
 *
 * @example
 * <DocumentUploadZone
 *   onFilesSelected={handleFiles}
 *   isUploading={isUploading}
 *   acceptedExtensions={["pdf", "jpg"]}
 *   maxFiles={5}
 * />
 */
export function DocumentUploadZone({
  onFilesSelected,
  isUploading,
  acceptedExtensions,
  maxFiles,
  className,
  enableRedaction = true,
}: DocumentUploadZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Redaction State
  const [fileToRedact, setFileToRedact] = useState<File | null>(null);

  const isAllowedDocument = useCallback(
    (file: File) => {
      // Pokud jsou custom přípony, použít je
      if (acceptedExtensions && acceptedExtensions.length > 0) {
        const name = file.name.toLowerCase();
        return acceptedExtensions.some((ext) =>
          name.endsWith(ext.startsWith(".") ? ext : `.${ext}`)
        );
      }

      // Default validace: MIME type nebo přípona
      if (file.type && DEFAULT_ALLOWED_MIME_TYPES.has(file.type)) return true;

      const name = file.name.toLowerCase();
      return DEFAULT_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
    },
    [acceptedExtensions]
  );

  const processFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;

    if (enableRedaction && files.length === 1 && REDACTABLE_TYPES.includes(files[0].type)) {
      setFileToRedact(files[0]);
      return;
    }

    onFilesSelected(files);
  }, [enableRedaction, onFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      let files = Array.from(e.dataTransfer.files).filter(isAllowedDocument);
      if (maxFiles && files.length > maxFiles) {
        files = files.slice(0, maxFiles);
      }
      processFiles(files);
    },
    [isAllowedDocument, processFiles, maxFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let files = Array.from(e.target.files || []);
      if (maxFiles && files.length > maxFiles) {
        files = files.slice(0, maxFiles);
      }
      processFiles(files);
      e.target.value = ""; // Reset input
    },
    [processFiles, maxFiles]
  );

  const acceptAttribute =
    acceptedExtensions && acceptedExtensions.length > 0
      ? acceptedExtensions
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
        .join(",")
      : DEFAULT_ALLOWED_EXTENSIONS.join(",");

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-6 transition-all duration-200 text-center",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-muted-foreground/30 hover:border-primary/50",
          isUploading && "opacity-50 pointer-events-none"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium mb-1">{t("promo.upload.dropzone")}</p>
        <p className="text-xs text-muted-foreground">
          {t("promo.upload.formats")}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-14 flex flex-col gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          <FileText className="h-5 w-5" />
          <span className="text-xs">{t("promo.upload.browse")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-14 flex flex-col gap-1"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isUploading}
        >
          <Camera className="h-5 w-5" />
          <span className="text-xs">{t("promo.upload.camera")}</span>
        </Button>
      </div>

      {/* Hidden Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttribute}
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />

      {/* Redactor Dialog */}
      {fileToRedact && (
        <Suspense fallback={null}>
          <DocumentRedactor
            file={fileToRedact}
            isOpen={true}
            onClose={() => {
              setFileToRedact(null);
            }}
            onSave={(redactedFile) => {
              onFilesSelected([redactedFile]);
              setFileToRedact(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
