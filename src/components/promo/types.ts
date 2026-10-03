import { z } from "zod";
import type { UseFormReturn } from "react-hook-form";
import type { TrackingDocumentCategory } from "@/hooks/useTrackingDocuments";
import type { Locale } from "date-fns";

export interface InvitationData {
  is_valid: boolean;
  study_name?: string | null;
  study_id?: string | null;
  parent_study_id?: string | null;
  parent_study_name?: string | null;
  partner_name?: string | null;
  partner_id?: string | null;
}

export interface UploadedDocument {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'analyzing' | 'completed' | 'error';
  category: TrackingDocumentCategory;
  documentId?: string;
  error?: string;
}

export interface AppointmentRequest {
  dayOfWeek: number;
  startTime: string;
}

// Schema factory to use translations
export const createPromoFormSchema = (t: (key: string, fallback?: string) => string) => z.object({
  email: z.string().email(t("validation.email")),
  firstName: z.string().min(1, t("validation.required")),
  lastName: z.string().min(1, t("validation.required")),
  dateOfBirth: z.date({ required_error: t("validation.required") }),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  physicalState: z.number().min(1).max(10).default(5),
  energyLevel: z.number().min(1).max(10).default(5),
});

export type PromoFormData = z.infer<ReturnType<typeof createPromoFormSchema>>;

export interface PromoStepProps {
  form: UseFormReturn<PromoFormData>;
  isLoggedIn: boolean;
  dateLocale: Locale;
}

export interface PromoStep3Props extends PromoStepProps {
  documents: UploadedDocument[];
  setDocuments: React.Dispatch<React.SetStateAction<UploadedDocument[]>>;
  isUploading: boolean;
}

export const PROMO_STEPS = [
  { id: 1, titleKey: "promo.steps.basicInfo", icon: "User" },
  { id: 2, titleKey: "promo.steps.healthState", icon: "Heart" },
  { id: 3, titleKey: "promo.steps.documents", icon: "FileText" },
  { id: 4, titleKey: "promo.steps.complete", icon: "CheckCircle" },
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function isAllowedDocument(file: File): boolean {
  if (file.type && ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) return true;

  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.ppt') ||
    name.endsWith('.pptx') ||
    name.endsWith('.txt') ||
    name.endsWith('.csv')
  );
}
