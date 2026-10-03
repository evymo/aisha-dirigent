import { z } from "zod";

export interface PacketaPickupPoint {
  id: number;
  name: string;
  city: string;
  street: string;
  zip: string;
  country: string;
  openingHours?: string;
}

export const checkoutSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string().trim().email("Invalid email address").max(255, "Email is too long"),
  phone: z.string().trim().min(9, "Phone number is required").max(20, "Phone number is too long").optional(),
  address: z.string().trim().max(500, "Address is too long").optional(),
  city: z.string().trim().max(100, "City is too long").optional(),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9\s-]{2,20}$/, "Invalid postal code format").optional(),
  country: z.string().trim().min(1, "Country is required").max(100, "Country is too long"),
});

export type CheckoutFormData = z.infer<typeof checkoutSchema>;

export type PaymentMethodOption = "card" | "bank_transfer";

export interface CheckoutConsents {
  gdpr: boolean;
  terms: boolean;
  professional: boolean;
  notMedicalAdvice: boolean;
  marketing: boolean;
  research: boolean;
  knowledgeCheck: boolean;
  informedConsent: boolean;
  commitment: boolean;
}

export const initialConsents: CheckoutConsents = {
  gdpr: false,
  terms: false,
  professional: false,
  notMedicalAdvice: false,
  marketing: false,
  research: false,
  knowledgeCheck: false,
  informedConsent: false,
  commitment: false,
};
