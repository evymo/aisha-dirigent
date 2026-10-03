import { describe, it, expect } from "vitest";
import { prelozChybu } from "@/lib/nahravani/prelozChybu";

const t = (k: string, o?: Record<string, unknown>) => (o?.reason ? `${k}:${String(o.reason)}` : k);

describe("překlad chyby nahrání", () => {
  it("kódy serveru dají lidský klíč", () => {
    expect(prelozChybu(Object.assign(new Error("x"), { code: "infected" }), t)).toBe("admin.media.infected");
    expect(prelozChybu(Object.assign(new Error("x"), { code: "502" }), t)).toBe("admin.media.scanUnavailable");
    expect(prelozChybu(Object.assign(new Error("sha256_mismatch"), { kod: "sha256_mismatch" }), t)).toBe(
      "admin.devices.tablets.apk.errors.sha256_mismatch",
    );
  });
  it("neznámá chyba nese důvod, nikdy prázdno", () => {
    expect(prelozChybu(new Error("síť"), t)).toBe("admin.media.uploadFailed:síť");
    expect(prelozChybu("divné", t)).toBe("admin.media.uploadFailed:divné");
  });
});
