import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode } from "lucide-react";
import { generateSpdString } from "@/lib/payments/spdQrCode";

import type { BankTransferQrData } from "@/lib/payments/spdQrCode";

interface BankTransferQrCodeProps {
  /** QR code data */
  data: BankTransferQrData;
  /** Whether to render a compact version (no card wrapper, smaller QR) */
  compact?: boolean;
  /** QR code size in pixels (default 200, compact default 140) */
  size?: number;
}

/**
 * Displays a QR code for Czech bank transfer (SPD format).
 *
 * Can be rendered as a full Card or a compact inline element.
 *
 * @example
 * ```tsx
 * <BankTransferQrCode
 *   data={{
 *     iban: "CZ6508000000192000145399",
 *     amount: 1500,
 *     variableSymbol: "1234567890",
 *   }}
 * />
 * ```
 */
export function BankTransferQrCode({
  data,
  compact = false,
  size,
}: BankTransferQrCodeProps) {
  const { t } = useTranslation();

  // Don't render if IBAN is missing or empty
  if (!data.iban || data.iban.trim().length === 0) {
    return null;
  }

  const spdString = generateSpdString(data);
  const qrSize = size ?? (compact ? 140 : 200);

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-2">
        <QRCodeSVG
          value={spdString}
          size={qrSize}
          level="M"
          includeMargin
          aria-label={t("checkout.bankTransfer.qrCode.ariaLabel")}
        />
        <span className="text-xs text-muted-foreground">
          {t("checkout.bankTransfer.qrCode.scanToPay")}
        </span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">
            {t("checkout.bankTransfer.qrCode.title")}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-white rounded-lg border">
            <QRCodeSVG
              value={spdString}
              size={qrSize}
              level="M"
              includeMargin
              aria-label={t("checkout.bankTransfer.qrCode.ariaLabel")}
            />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            {t("checkout.bankTransfer.qrCode.description")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
