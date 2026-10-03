/**
 * Kódy chyb ze serveru (antivirus, sken, otisk APK…) → lidská věta pro nahrávací
 * pole. Kód se čte z `kod`/`code` chyby (ChybaNahraniHlidace, ApiError) nebo
 * z její zprávy; neznámé → obecná hláška s důvodem, nikdy prázdno.
 */
/** Kódy ze serveru (antivirus, sken, otisk APK…) → lidská věta; neznámé → obecná hláška s důvodem. */
export function prelozChybu(err: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  const kod = (err as { kod?: string; code?: string })?.kod ?? (err as { code?: string })?.code;
  const zprava = err instanceof Error ? err.message : String(err);
  const klic = kod ?? zprava;
  switch (klic) {
    case "infected":
    case "422":
      return t("admin.media.infected");
    case "scan_unavailable":
    case "502":
      return t("admin.media.scanUnavailable");
    case "sha256_not_declared":
      return t("admin.devices.tablets.apk.errors.sha256_not_declared");
    case "sha256_mismatch":
      return t("admin.devices.tablets.apk.errors.sha256_mismatch");
    default:
      return t("admin.media.uploadFailed", { reason: zprava });
  }
}
