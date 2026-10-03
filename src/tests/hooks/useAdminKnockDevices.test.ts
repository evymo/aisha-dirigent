import { describe, expect, it } from "vitest";
import { knockDeviceStatus } from "@/hooks/useAdminKnockDevices";
import { knockDeviceAdminArraySchema } from "@/lib/schemas/adminSchemas";

const ROW = {
  kid: "dev-0123456789abcdef",
  public_key_hex: `04${"ab".repeat(64)}`,
  scope: "ridic",
  owner_user_id: "11111111-1111-4111-8111-111111111111",
  push_device_id: null,
  first_seen_at: "2026-09-16T20:00:00+00:00",
  last_seen_at: "2026-09-16T21:00:00+00:00",
  approved_at: null,
  revoked_at: null,
  uzivatele: [],
};

describe("knockDeviceStatus", () => {
  it("bez schválení i odvolání čeká", () => {
    expect(knockDeviceStatus({ approved_at: null, revoked_at: null })).toBe("pending");
  });

  it("schválené je schválené", () => {
    expect(knockDeviceStatus({ approved_at: "2026-09-16T21:00:00+00:00", revoked_at: null })).toBe("approved");
  });

  it("⛔ odvolání má přednost, i kdyby v datech zůstalo schválení", () => {
    expect(
      knockDeviceStatus({ approved_at: "2026-09-16T21:00:00+00:00", revoked_at: "2026-09-16T22:00:00+00:00" }),
    ).toBe("revoked");
  });
});

describe("knockDeviceAdminArraySchema", () => {
  it("přijme řádek bez push mostu a s uživateli", () => {
    const rows = [
      ROW,
      {
        ...ROW,
        kid: "dev-fedcba9876543210",
        push_device_id: "push-1",
        uzivatele: [{ user_id: "22222222-2222-4222-8222-222222222222", last_active_at: null }],
      },
    ];
    expect(knockDeviceAdminArraySchema.parse(rows)).toHaveLength(2);
  });

  it("⛔ odmítne řádek bez seznamu uživatelů — tvar RPC se nesmí tiše rozejít", () => {
    const { uzivatele: _pryc, ...bezUzivatelu } = ROW;
    expect(knockDeviceAdminArraySchema.safeParse([bezUzivatelu]).success).toBe(false);
  });

  it("přijme TABLET, který se ohlásil sám — bez vlastníka, s adresou a verzemi", () => {
    // Jediný řádek s neplatným tvarem by shodil celý seznam ke schválení.
    const tablet = {
      ...ROW,
      owner_user_id: null,
      druh: "tablet",
      ohlaseno_z_ip: "198.51.100.83",
      verze: { ridic: "1.1.1 (15)", kioskAdmin: "1.5.0 (7)" },
    };
    expect(knockDeviceAdminArraySchema.parse([ROW, tablet])).toHaveLength(2);
  });

  it("⛔ odmítne vlastníka, který není uuid", () => {
    expect(knockDeviceAdminArraySchema.safeParse([{ ...ROW, owner_user_id: "nekdo" }]).success).toBe(false);
  });
});
