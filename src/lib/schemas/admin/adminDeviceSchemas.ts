/**
 * Admin Device Schemas — průkazy zařízení pro dveře (`knock_device_credentials`)
 * tak, jak je vrací `admin_list_knock_devices`.
 */

import { z } from "zod";

/**
 * Kdo zařízení POUŽÍVÁ. Nečte se z průkazu, ale z `mobile_sessions` přes most
 * `push_device_id` — průkaz sám nese jen toho, kdo zařízení zavedl.
 */
export const knockDeviceUserSchema = z.object({
  user_id: z.string().uuid(),
  last_active_at: z.string().nullable(),
});

export const knockDeviceAdminRowSchema = z.object({
  kid: z.string().min(1),
  public_key_hex: z.string(),
  scope: z.string(),
  // Nullable: TABLET se ohlásí sám (enrol_kiosk_device), bez přihlášeného člověka.
  owner_user_id: z.string().uuid().nullable(),
  // Nullable: průkaz může vzniknout dřív, než si appka vyzvedne push id.
  push_device_id: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  approved_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  uzivatele: z.array(knockDeviceUserSchema),
  /** `osobni` = telefon zavedený přihlášeným člověkem, `tablet` = kiosk se ohlásil sám. */
  druh: z.enum(["osobni", "tablet"]).optional(),
  /** Odkud se tablet ohlásil — správce ji porovná s místem, kde tablet leží. */
  ohlaseno_z_ip: z.string().nullable().optional(),
  /** Verze aplikací, které tablet při ohlášení uvedl. */
  verze: z.record(z.string(), z.string()).nullable().optional(),
});

export const knockDeviceAdminArraySchema = z.array(knockDeviceAdminRowSchema);

export type KnockDeviceUser = z.infer<typeof knockDeviceUserSchema>;
export type KnockDeviceAdminRow = z.infer<typeof knockDeviceAdminRowSchema>;
