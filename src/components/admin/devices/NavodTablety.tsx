import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Návod pro technika: od tovární krabice po tablet v kiosku, provoz, servis
 * a uvolnění. Stojí u QR, protože se podle něj pracuje právě tady — a text
 * na jiné stránce by se rozešel s tím, co panel skutečně umí.
 *
 * Kroky jsou číslované klíče překladu (ne pole), aby každý šel přeložit
 * a zkontrolovat zvlášť.
 */
export const ODDILY = [
  { klic: "prep", kroku: 3 },
  { klic: "setup", kroku: 7 },
  { klic: "run", kroku: 2 },
  { klic: "out", kroku: 5 },
  { klic: "release", kroku: 1 },
] as const;

export function NavodTablety({ kiosk, okno }: { kiosk: string; okno: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          {t("admin.devices.tablets.guide.title")}
        </CardTitle>
        <CardDescription>{t("admin.devices.tablets.guide.subtitle", { kiosk })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ODDILY.map(({ klic, kroku }) => (
          <details key={klic} className="rounded-md border px-4 py-2" open={klic === "setup"}>
            <summary className="cursor-pointer font-medium">{t(`admin.devices.tablets.guide.${klic}.title`)}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {Array.from({ length: kroku }, (_, i) => (
                <li key={i}>{t(`admin.devices.tablets.guide.${klic}.${i + 1}`, { kiosk, window: okno })}</li>
              ))}
            </ol>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
