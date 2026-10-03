import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { jeNaseUloziste, vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";
import { cn } from "@/lib/utils";

/**
 * Ohnisko a přiblížení titulního obrázku — VÝŘEZ POHLEDU, obrázek se nemění.
 *
 * Náhled je karta 16:9 (tak ho zobrazí blok novinek). Klik do náhledu položí
 * ohnisko, posuvník přiblíží. U obrázku z našeho úložiště je náhled to, co
 * uvidí čtenář (doručení přes imgproxy s týmiž parametry, s krátkou prodlevou,
 * ať se neposílá požadavek na každý pixel); u cizí adresy (import) se výřez
 * jen napodobí CSS (object-position + scale) — bloky si ho tam neumí vyžádat.
 */
export interface Ohnisko {
  fx: number;
  fy: number;
  zoom: number;
}

export interface OhniskoObrazkuProps {
  url: string;
  hodnota: Ohnisko;
  onChange: (o: Ohnisko) => void;
  disabled?: boolean;
  className?: string;
}

const NAHLED_W = 640;
const NAHLED_H = 360;

export function OhniskoObrazku({ url, hodnota, onChange, disabled, className }: OhniskoObrazkuProps) {
  const { t } = useTranslation();
  const nase = jeNaseUloziste(url);
  const [nahledUrl, setNahledUrl] = useState<string>(url);

  // Prodleva 250 ms: posuvník i klik mění hodnoty rychle; požadavek jde až po klidu.
  useEffect(() => {
    if (!nase) {
      setNahledUrl(url);
      return;
    }
    const h = setTimeout(() => setNahledUrl(vyrezObrazku(url, { w: NAHLED_W, h: NAHLED_H, ...hodnota }) ?? url), 250);
    return () => clearTimeout(h);
  }, [url, nase, hodnota]);

  const px = `${Math.round(hodnota.fx * 100)}%`;
  const py = `${Math.round(hodnota.fy * 100)}%`;
  const cssNapodoba = nase
    ? undefined
    : ({ objectPosition: `${px} ${py}`, transform: `scale(${hodnota.zoom})`, transformOrigin: `${px} ${py}` } as const);

  const naKlik = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const fy = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    onChange({ ...hodnota, fx: Number(fx.toFixed(3)), fy: Number(fy.toFixed(3)) });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <Label>{t("admin.newsArticles.form.focus")}</Label>
        <div
          role="img"
          aria-label={t("admin.newsArticles.form.cover")}
          onClick={naKlik}
          className={cn("relative aspect-[16/9] w-full max-w-xl overflow-hidden rounded-md border bg-muted", !disabled && "cursor-crosshair")}
        >
          <img src={nahledUrl} alt="" className="h-full w-full object-cover" style={cssNapodoba} draggable={false} />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/80 shadow"
            style={{ left: `${hodnota.fx * 100}%`, top: `${hodnota.fy * 100}%` }}
          />
        </div>
      </div>
      <div className="max-w-xl space-y-1">
        <Label htmlFor="zoom-obrazku">
          {t("admin.newsArticles.form.zoom")} · {hodnota.zoom.toFixed(1)}×
        </Label>
        <Slider
          id="zoom-obrazku"
          min={1}
          max={4}
          step={0.1}
          value={[hodnota.zoom]}
          onValueChange={([z]) => onChange({ ...hodnota, zoom: Number(z.toFixed(2)) })}
          disabled={disabled}
        />
      </div>
      <p className="text-xs text-muted-foreground max-w-xl">{t("admin.newsArticles.form.coverHint")}</p>
    </div>
  );
}
