/**
 * Zod schemas for web_pages table RPC responses.
 *
 * Used by useWebPage and useAdminWebPages hooks.
 *
 * @module
 */

import { z } from "zod";

/** Schema for public web page (get_web_page_by_slug response) */
export const webPagePublicSchema = z.object({
  canvas_css: z.string().nullable(),
  canvas_data: z.unknown().nullable(),
  canvas_html: z.string().nullable(),
  description_key: z.string().nullable(),
  id: z.string().uuid(),
  og_image_url: z.string().nullable(),
  page_settings: z.unknown().nullable().default(null),
  slug: z.string(),
  title_key: z.string(),
});

/** Schema for admin web page list item (get_web_pages_admin response) */
export const webPageAdminListSchema = z.object({
  branding_profile_id: z.string().uuid().nullable().default(null),
  created_at: z.string(),
  description_key: z.string().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  og_image_url: z.string().nullable(),
  // Nese `role: "partial"` u sdílených útržků — administrace podle toho pozná,
  // že záznam nemá vlastní adresu a nedá se navštívit.
  page_settings: z.unknown().nullable().default(null),
  slug: z.string(),
  sort_order: z.number(),
  status: z.string(),
  title_key: z.string(),
  updated_at: z.string(),
});

/** Schema for admin web page detail (get_web_page_admin response) */
export const webPageAdminDetailSchema = z.object({
  branding_profile_id: z.string().uuid().nullable().default(null),
  canvas_css: z.string().nullable(),
  canvas_data: z.unknown().nullable(),
  canvas_html: z.string().nullable(),
  created_at: z.string(),
  description_key: z.string().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  og_image_url: z.string().nullable(),
  page_settings: z.unknown().nullable().default(null),
  slug: z.string(),
  sort_order: z.number(),
  status: z.string(),
  title_key: z.string(),
  updated_at: z.string(),
});

/** Schema for an admin brand "site" (get_branding_sites_admin response) */
export const brandingSiteAdminSchema = z.object({
  branding_profile_id: z.string().uuid(),
  hostnames: z.array(z.string()).default([]),
  operator_name: z.string().nullable(),
  status: z.string(),
});

/** Inferred types */
export type WebPagePublic = z.infer<typeof webPagePublicSchema>;

/**
 * Sdílený útržek (hlavička, patička) — `get_published_web_partials`.
 *
 * Útržek je `web_pages` se `page_settings->>'role' = 'partial'`: týž editor,
 * totéž plátno. Servíruje se jen jako VLOŽENÝ obsah stránky, nikdy jako
 * samostatná adresa — proto ho stránkové funkce filtrují ven.
 */
export const webPartialSchema = z.object({
  canvas_css: z.string().nullable(),
  canvas_html: z.string().nullable(),
  ref: z.string(),
});

export type WebPartial = z.infer<typeof webPartialSchema>;
export type WebPageAdminList = z.infer<typeof webPageAdminListSchema>;
export type WebPageAdminDetail = z.infer<typeof webPageAdminDetailSchema>;
export type BrandingSiteAdmin = z.infer<typeof brandingSiteAdminSchema>;
