/**
 * Dialog „Složit ikonu“ — favicon z obrázku autora na zvoleném pozadí.
 *
 * Autor vybere obrázek (i SVG — načte se jen lokálně), tvar pozadí, jeho barvu
 * a okraj; náhled ukazuje velikost záložky prohlížeče i ikony na ploše.
 * „Použít“ složí PNG v prohlížeči (lib/media/slozeniIkony.ts), nahraje ho
 * stejnou cestou jako obrázky stránek (usePageAssetUpload) a vrátí adresu.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { safeError } from "@/lib/security/safeLogger";
import { nactiObrazek, slozIkonu, vykresliIkonu, type TvarPozadi, type VolbyIkony } from "@/lib/media/slozeniIkony";

/** Co dialog přijme na vstupu (SVG se nenahrává — jen vykreslí). */
export const VSTUPNI_TYPY_IKONY = "image/png,image/jpeg,image/webp,image/svg+xml";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Výchozí barva pozadí (#rrggbb), typicky primární barva webu. */
  vychoziBarva: string;
  /** Nahraje hotové PNG a vrátí jeho veřejnou adresu. */
  nahraj: (soubor: File) => Promise<string>;
  /** Hotovo: adresa nahrané ikony. */
  onHotovo: (adresa: string) => void;
}

const NAHLEDY = [16, 32, 64] as const;

export function SlozeniIkonyDialog({ open, onOpenChange, vychoziBarva, nahraj, onHotovo }: Props) {
  const { t } = useTranslation();
  const [zdroj, setZdroj] = useState<File | null>(null);
  const [obrazek, setObrazek] = useState<HTMLImageElement | null>(null);
  const [volby, setVolby] = useState<VolbyIkony>({ tvar: "kruh", barva: vychoziBarva, okraj: 0.12 });
  const [pracuji, setPracuji] = useState(false);
  const nahledy = useRef<Record<number, HTMLCanvasElement | null>>({});

  useEffect(() => {
    if (open) setVolby((v) => ({ ...v, barva: vychoziBarva }));
  }, [open, vychoziBarva]);

  useEffect(() => {
    if (!zdroj) {
      setObrazek(null);
      return;
    }
    let platny = true;
    nactiObrazek(zdroj).then(
      (img) => platny && setObrazek(img),
      (chyba: unknown) => {
        safeError("SlozeniIkonyDialog.nactiObrazek", chyba);
        toast.error(t("admin.settings.brandingProfile.icon.loadError"));
      },
    );
    return () => {
      platny = false;
    };
  }, [zdroj, t]);

  useEffect(() => {
    if (!obrazek) return;
    for (const strana of NAHLEDY) {
      const platno = nahledy.current[strana];
      const ctx = platno?.getContext("2d");
      if (ctx) vykresliIkonu(ctx, obrazek, strana, volby);
    }
  }, [obrazek, volby]);

  const pouzij = async () => {
    if (!zdroj) return;
    setPracuji(true);
    try {
      const png = await slozIkonu(zdroj, volby, "favicon.png");
      onHotovo(await nahraj(png));
      onOpenChange(false);
    } catch (chyba) {
      safeError("SlozeniIkonyDialog.pouzij", chyba);
      toast.error(t("admin.settings.brandingProfile.icon.uploadError"));
    } finally {
      setPracuji(false);
    }
  };

  const tvary: TvarPozadi[] = ["kruh", "ctverec", "zadne"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.settings.brandingProfile.icon.title")}</DialogTitle>
          <DialogDescription>{t("admin.settings.brandingProfile.icon.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="ikona-zdroj">{t("admin.settings.brandingProfile.icon.source")}</Label>
            <input
              id="ikona-zdroj"
              type="file"
              accept={VSTUPNI_TYPY_IKONY}
              className="block w-full text-sm"
              onChange={(e) => setZdroj(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1">
            <Label>{t("admin.settings.brandingProfile.icon.shape")}</Label>
            <div className="flex gap-2" role="radiogroup">
              {tvary.map((tvar) => (
                <Button
                  key={tvar}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={volby.tvar === tvar}
                  variant={volby.tvar === tvar ? "default" : "outline"}
                  onClick={() => setVolby((v) => ({ ...v, tvar }))}
                >
                  {t(`admin.settings.brandingProfile.icon.shapes.${tvar}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="ikona-barva">{t("admin.settings.brandingProfile.icon.color")}</Label>
              <input
                id="ikona-barva"
                type="color"
                value={volby.barva}
                disabled={volby.tvar === "zadne"}
                onChange={(e) => setVolby((v) => ({ ...v, barva: e.target.value }))}
                className="h-9 w-14 cursor-pointer rounded border"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="ikona-okraj">{t("admin.settings.brandingProfile.icon.padding")}</Label>
              <input
                id="ikona-okraj"
                type="range"
                min={0}
                max={0.3}
                step={0.01}
                value={volby.okraj}
                onChange={(e) => setVolby((v) => ({ ...v, okraj: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t("admin.settings.brandingProfile.icon.preview")}</Label>
            <div className="flex items-end gap-4 rounded-md border bg-muted/40 p-3">
              {NAHLEDY.map((strana) => (
                <canvas
                  key={strana}
                  width={strana}
                  height={strana}
                  aria-hidden="true"
                  ref={(el) => {
                    nahledy.current[strana] = el;
                  }}
                  style={{ width: strana, height: strana }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void pouzij()} disabled={!zdroj || !obrazek || pracuji}>
            {pracuji ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("admin.settings.brandingProfile.icon.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
