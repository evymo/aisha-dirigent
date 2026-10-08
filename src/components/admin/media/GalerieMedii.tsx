import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NahravaciPole } from "@/components/admin/media/NahravaciPole";
import { ALLOWED_ASSET_TYPES, MAX_ASSET_BYTES, usePageAssetUpload } from "@/hooks/usePageAssetUpload";
import { useDeleteMediaAsset, useInvalidateMediaAssets, useMediaAssets, verejnaAdresaMedia, type MediaAsset } from "@/hooks/useMediaAssets";
import { vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";

/**
 * Galerie nahraných médií: hledání, náhledy, „použít", nahrání nového a mazání.
 * Zdroj je evidence `media_assets` (úložiště výpis neumí). Náhledy jdou přes
 * výřez 240×160, takže se nestahují originály.
 */
export interface GalerieMediiProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (url: string, medium: MediaAsset) => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";

export function GalerieMedii({ open, onOpenChange, onPick }: GalerieMediiProps) {
  const { t } = useTranslation();
  const [hledani, setHledani] = useState("");
  const [keSmazani, setKeSmazani] = useState<MediaAsset | null>(null);
  const { data, isLoading } = useMediaAssets(hledani);
  const smazat = useDeleteMediaAsset();
  const obnovSeznam = useInvalidateMediaAssets();
  const { uploadAsset } = usePageAssetUpload();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.media.title")}</DialogTitle>
          <DialogDescription>{t("admin.media.heicHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <NahravaciPole
            povoleneTypy={ALLOWED_ASSET_TYPES}
            accept={ACCEPT}
            maxBytes={MAX_ASSET_BYTES}
            kompaktni
            onFile={async (soubor, onProgress, signal) => {
              const url = await uploadAsset(soubor, { onProgress, signal });
              void obnovSeznam();
              onPick(url, { id: "", bucket: "page-assets", object_key: "", content_type: soubor.type, bytes: soubor.size, original_name: soubor.name, uploaded_by: null, created_at: new Date().toISOString() });
            }}
          />
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input value={hledani} onChange={(e) => setHledani(e.target.value)} placeholder={t("admin.media.search")} className="pl-8" aria-label={t("admin.media.search")} />
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.media.empty")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label={t("admin.media.title")}>
              {data.map((m) => {
                const url = verejnaAdresaMedia(m);
                // Galerie vybírá OBRÁZEK (editor, titulní obrázek). PDF a jiné soubory
                // (např. převzaté dokumenty GDPR, 2026-10-03) se ukážou, ale vybrat nejdou —
                // jinak by výřez přes imgproxy dal rozbitý náhled a do <img> by šlo PDF.
                const jeObrazek = m.content_type.startsWith("image/");
                const jmeno = m.original_name ?? m.object_key.split("/").pop() ?? "";
                return (
                  <li key={m.id} className="group relative overflow-hidden rounded-md border bg-muted">
                    <button
                      type="button"
                      className="block w-full disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => onPick(url, m)}
                      disabled={!jeObrazek}
                      title={jeObrazek ? (m.original_name ?? m.object_key) : t("admin.media.notImage", { name: jmeno })}
                    >
                      {jeObrazek ? (
                        <img src={vyrezObrazku(url, { w: 240, h: 160 }) ?? url} alt={m.original_name ?? ""} className="aspect-[3/2] w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex aspect-[3/2] w-full items-center justify-center bg-background" aria-hidden="true">
                          <FileText className="h-10 w-10 text-muted-foreground" />
                        </span>
                      )}
                      <span className="block truncate px-2 py-1 text-left text-xs">{m.original_name ?? m.object_key.split("/").pop()}</span>
                      <span className="block px-2 pb-1 text-left text-[11px] text-muted-foreground">{t("admin.media.bytes", { kb: Math.max(1, Math.round(m.bytes / 1024)) })}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 h-7 w-7 bg-background/80 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      aria-label={t("admin.media.delete")}
                      onClick={() => setKeSmazani(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>

      <AlertDialog open={!!keSmazani} onOpenChange={(o) => !o && setKeSmazani(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.media.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={smazat.isPending}
              onClick={async () => {
                if (!keSmazani) return;
                try {
                  await smazat.mutateAsync(keSmazani);
                  toast.success(t("admin.media.deleted"));
                } catch (err) {
                  toast.error(t("admin.media.uploadFailed", { reason: err instanceof Error ? err.message : String(err) }));
                } finally {
                  setKeSmazani(null);
                }
              }}
            >
              {smazat.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
