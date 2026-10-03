import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload, Camera, FileText } from "lucide-react";

import { isAllowedDocument } from "@/lib/validation/documentValidators";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =============================================================================
// Document Upload Component (Mobile-optimized with drag & drop)
// =============================================================================

interface DocumentUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isUploading: boolean;
}

export function DocumentUploadZone({ onFilesSelected, isUploading }: DocumentUploadZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      isAllowedDocument
    );
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = ''; // Reset input
  }, [onFilesSelected]);

  return (
    <div className="space-y-4">
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
        <p className="text-sm font-medium mb-1">
          {t("promo.upload.dropzone")}
        </p>
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
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
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
    </div>
  );
}
