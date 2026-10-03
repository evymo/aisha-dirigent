/**
 * Admin Commerce Schemas — products, orders, payments, subscriptions, distribution
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { z } from "zod";

// ==========================================
// AdminProducts Schemas
// ==========================================

// Schema must match RPC return column order (alphabetical)
export const productAdminRowSchema = z.object({
  archive_document_id: z.string().nullable(),
  category: z.string().nullable(),
  compare_at_price: z.number().nullable(),
  created_at: z.string(),
  description: z.string().nullable(),
  description_key: z.string().nullable(),
  doses_per_package: z.number(),
  id: z.string().uuid(),
  image_url: z.string().nullable(),
  images: z.array(z.string()).nullable(),
  in_stock: z.boolean(),
  name: z.string(),
  name_key: z.string().nullable(),
  price: z.number(),
  short_description: z.string().nullable(),
  short_description_key: z.string().nullable(),
  slug: z.string(),
  stock_quantity: z.number().nullable(),
  target_audience: z.string().nullable(),
  updated_at: z.string(),
  use_case: z.string().nullable(),
  // Translation metadata + marketing keys
  base_locale: z.string().nullable(),
  badge_key: z.string().nullable(),
  tagline_key: z.string().nullable(),
  image_alt_key: z.string().nullable(),
  benefits_title_key: z.string().nullable(),
  composition_title_key: z.string().nullable(),
  usage_title_key: z.string().nullable(),
  origin_content: z.record(z.unknown()).nullable(),
  benefits_content: z.record(z.unknown()).nullable(),
  substances_content: z.record(z.unknown()).nullable(),
  usage_content: z.record(z.unknown()).nullable(),
  default_protocol_id: z.string().uuid().nullable(),
});

export type ProductAdminRow = z.infer<typeof productAdminRowSchema>;

export const productAdminArraySchema = z.array(productAdminRowSchema);

// ==========================================
// AdminMemberSubscriptions Schemas
// ==========================================

export const memberSubscriptionRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  package_id: z.string().uuid().nullable(),
  membership_id: z.string().uuid().nullable(),
  amount_paid: z.number(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  status: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  created_at: z.string(),
  package: z.object({
    name: z.string(),
    tier: z.string(),
    period: z.string(),
  }).nullable(),
});

export type MemberSubscriptionRow = z.infer<typeof memberSubscriptionRowSchema>;

// ==========================================
// AdminOrders Schemas
// ==========================================

export const orderRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.string(),
  total: z.number(),
  subtotal: z.number().nullable().optional(),
  shipping: z.number().nullable().optional(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
  shipping_address: z.record(z.unknown()).nullable(),
  billing_address: z.record(z.unknown()).nullable(),
  order_items: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number(),
    price_at_purchase: z.number(),
    product: z.object({
      name: z.string(),
      slug: z.string().optional().default(""),
    }).nullable(),
  })),
});

export type OrderRow = z.infer<typeof orderRowSchema>;

// ==========================================
// AdminDistribution Schemas
// ==========================================

/**
 * Schema pro nastavení distribuce/shipmentu.
 * Všechna pole jsou optional s defaults aby se předešlo Zod validation errors
 * při neúplných datech z DB.
 */
export const shipmentSettingsSchema = z.object({
  auto_create_packeta: z.object({
    enabled: z.boolean().default(false),
    delay_minutes: z.number().default(0),
  }).default({ enabled: false, delay_minutes: 0 }),
  auto_ship_days: z.object({
    enabled: z.boolean().default(false),
    days: z.array(z.string()).default(["monday", "wednesday", "friday"]),
  }).default({ enabled: false, days: ["monday", "wednesday", "friday"] }),
  auto_ship_time: z.object({
    time: z.string().default("14:00"),
    timezone: z.string().default("Europe/Prague"),
  }).default({ time: "14:00", timezone: "Europe/Prague" }),
  notification_email: z.object({
    email: z.string().nullable().default(null),
    send_on_new_order: z.boolean().default(true),
    send_on_shipment: z.boolean().default(true),
  }).default({ email: null, send_on_new_order: true, send_on_shipment: true }),
  packeta_defaults: z.object({
    default_weight: z.number().default(0.5),
    default_value: z.number().default(50),
    sender_name: z.string().default("Platform"),
  }).default({ default_weight: 0.5, default_value: 50, sender_name: "Platform" }),
  // shipping_rates - MUST have defaults to avoid optional issues in UI state
  shipping_rates: z.object({
    base_currency: z.string().default(BASE_CURRENCY_FALLBACK),
    methods: z.record(z.object({
      default: z.number(),
      by_country: z.record(z.number()).optional(),
    })).default({}),
  }).default({ base_currency: BASE_CURRENCY_FALLBACK, methods: {} }),
}).passthrough();

export type ShipmentSettings = z.infer<typeof shipmentSettingsSchema>;

export const distributionScheduleSchema = z.object({
  id: z.string().uuid(),
  scheduled_date: z.string(),
  scheduled_time: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]),
  orders_count: z.number(),
  processed_count: z.number(),
  failed_count: z.number(),
  notes: z.string().nullable(),
  created_at: z.string(),
  processed_at: z.string().nullable(),
  orders: z
    .array(
      z.object({
        order_id: z.string(),
        status: z.string(),
      })
    )
    .nullable()
    .optional(),
});

export type DistributionSchedule = z.infer<typeof distributionScheduleSchema>;

export const distributionScheduleArraySchema = z.array(distributionScheduleSchema);

// ==========================================
// AdminDistributionForecast Schemas
// Matches get_distribution_forecasts_admin RPC
// ==========================================

export const forecastDataSchema = z.object({
  id: z.string().uuid(),
  forecast_month: z.string(),
  product_id: z.string().uuid(),
  study_id: z.string().uuid(),
  total_members: z.number(),
  vip_members: z.number(),
  required_packages: z.number(),
  compensated_value: z.number(),
  production_status: z.string(),
  reported_deviation_percent: z.number(),
  deviation_sample_size: z.number(),
  linked_batch_id: z.string().uuid().nullable(),
  product_name: z.string(),
  study_name: z.string(),
  study_code: z.string(),
});

export type ForecastData = z.infer<typeof forecastDataSchema>;

export const forecastDataArraySchema = z.array(forecastDataSchema);

// ==========================================
// AdminPayments Schemas
// ==========================================

export const orderWithPaymentRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_email: z.string().nullable().optional(),
  user_name: z.string().nullable().optional(),
  status: z.string(),
  total: z.number(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  stripe_payment_intent_id: z.string().nullable(),
  shipping_address: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OrderWithPaymentRow = z.infer<typeof orderWithPaymentRowSchema>;

export const orderWithPaymentArraySchema = z.array(orderWithPaymentRowSchema);

export const profilePaymentRowSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
});

export type ProfilePaymentRow = z.infer<typeof profilePaymentRowSchema>;

export const profilePaymentArraySchema = z.array(profilePaymentRowSchema);
