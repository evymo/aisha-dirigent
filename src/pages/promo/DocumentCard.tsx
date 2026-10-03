import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Image as ImageIcon,
  File,
} from "lucide-react";

import { type TrackingDocumentCategory } from "@/hooks/useTrackingDocuments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { UploadedDocument } from "./promoOnboardingSchemas";

// =============================================================================
// Clock icon for pending status (inline SVG)
// =============================================================================

function Clock({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// =============================================================================
// Uploaded Document Card
// =============================================================================

interface DocumentCardProps {
  doc: UploadedDocument;
  onRemove: (id: string) => void;
  onCategoryChange: (id: string, category: TrackingDocumentCategory) => void;
}

export function DocumentCard({ doc, onRemove, onCategoryChange }: DocumentCardProps) {
  const { t } = useTranslation();
  const isImage = doc.file.type.startsWith('image/');

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
    uploading: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
    uploaded: <CheckCircle className="h-4 w-4 text-green-500" />,
    analyzing: <Loader2 className="h-4 w-4 animate-spin text-purple-500" />,
    completed: <CheckCircle className="h-4 w-4 text-green-600" />,
    error: <AlertCircle className="h-4 w-4 text-destructive" />,
  };

  const statusLabels = {
    pending: t("promo.document.pending"),
    uploading: t("promo.document.uploading"),
    uploaded: t("promo.document.uploaded"),
    analyzing: t("promo.document.analyzing"),
    completed: t("promo.document.completed"),
    error: t("promo.document.error"),
  };

  return (
    <Card className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 rounded-full"
        onClick={() => onRemove(doc.id)}
        disabled={doc.status === 'uploading' || doc.status === 'analyzing'}
      >
        <X className="h-4 w-4" />
      </Button>

      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            {isImage ? (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            ) : (
              <File className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{doc.file.name}</p>
            <div className="flex items-center gap-2 mt-1">
              {statusIcons[doc.status]}
              <span className="text-xs text-muted-foreground">
                {doc.error || statusLabels[doc.status]}
              </span>
            </div>
          </div>
        </div>

        {doc.status === 'pending' && (
          <div className="mt-3">
            <Label className="text-xs">{t("promo.document.category")}</Label>
            <Select
              value={doc.category}
              onValueChange={(value) => onCategoryChange(doc.id, value as TrackingDocumentCategory)}
            >
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lab_results">{t("member.documents.categories.labResults")}</SelectItem>
                <SelectItem value="medical_report">{t("member.documents.categories.medicalReport")}</SelectItem>
                <SelectItem value="imaging">{t("member.documents.categories.imaging")}</SelectItem>
                <SelectItem value="prescription">{t("member.documents.categories.prescription")}</SelectItem>
                <SelectItem value="other">{t("member.documents.categories.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
