import { z } from "zod";
import type { TrackingDocumentCategory } from "@/hooks/useTrackingDocuments";

// =============================================================================
// Types & Schema for PromoOnboarding
// =============================================================================

export interface UploadedDocument {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'analyzing' | 'completed' | 'error';
  category: TrackingDocumentCategory;
  documentId?: string;
  error?: string;
}

/**
 * Base promo form schema without password refinement.
 * Used for per-step validation via `.pick()`.
 */
export const createBasePromoFormSchema = (
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  return z.object({
    email: z.string().email(t("validation.email")),
    firstName: z.string().min(1, t("validation.required")),
    lastName: z.string().min(1, t("validation.required")),
    dateOfBirth: z.date({ required_error: t("validation.required") }),
    gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
    physicalState: z.number().min(1).max(10).default(5),
    energyLevel: z.number().min(1).max(10).default(5),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  });
};

/**
 * Full promo form schema with conditional password validation.
 * Password is required for new users, optional for logged-in users with password already set.
 */
export const createPromoFormSchema = (
  t: (key: string, options?: Record<string, unknown>) => string,
  requirePassword: boolean
) => {
  const baseSchema = createBasePromoFormSchema(t);

  if (requirePassword) {
    return baseSchema
      .extend({
        password: z.string()
          .min(8, t("validation.passwordMin8"))
          .regex(/[A-Z]/, t("validation.passwordUppercase"))
          .regex(/[a-z]/, t("validation.passwordLowercase"))
          .regex(/[0-9]/, t("validation.passwordNumber")),
        confirmPassword: z.string().min(1, t("validation.required")),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: t("validation.passwordsNotMatch"),
        path: ["confirmPassword"],
      });
  }

  return baseSchema;
};

export type PromoFormData = z.infer<ReturnType<typeof createPromoFormSchema>>;
