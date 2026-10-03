import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Upload, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { prelozChybu } from "@/lib/nahravani/prelozChybu";

/**
 * Nahrávací pole — JEDNA komponenta pro všechny cesty nahrávání (obrázky článků,
 * galerie médií, APK hlídače tabletů). Přetažení, výběr souboru, vložení ze
 * schránky (Ctrl+V nad polem), průběh v procentech, zrušení a srozumitelná chyba.
 *
 * Co nahrání znamená, rozhoduje volající přes `onFile` (dostane soubor, hlásič
 * průběhu a signal pro zrušení). Pole samo hlídá jen typ a velikost PŘED
 * odesláním, aby uživatel dostal důvod hned, ne „nahrání selhalo" po minutě.
 */
export interface NahravaciPoleProps {
  /** Povolené MIME typy (přesná shoda). */
  povoleneTypy: ReadonlySet<string>;
  /** Hodnota atributu `accept` pro výběr souboru (přípony/MIME). */
  accept: string;
  maxBytes: number;
  onFile: (soubor: File, onProgress: (podil: number) => void, signal: AbortSignal) => Promise<void>;
  /** Text tlačítka / názvu akce (i18n klíč už přeložený). */
  popisek?: string;
  /** Poznámka pod polem (např. doporučený rozměr). */
  napoveda?: string;
  /** Zúžená varianta (řádek místo plochy). */
  kompaktni?: boolean;
  disabled?: boolean;
  className?: string;
}

type Stav =
  | { druh: "klid" }
  | { druh: "nahravam"; podil: number; jmeno: string }
  | { druh: "hotovo"; jmeno: string }
  | { druh: "chyba"; text: string };

export function NahravaciPole({
  povoleneTypy,
  accept,
  maxBytes,
  onFile,
  popisek,
  napoveda,
  kompaktni,
  disabled,
  className,
}: NahravaciPoleProps) {
  const { t } = useTranslation();
  const [stav, setStav] = useState<Stav>({ druh: "klid" });
  const [tahnu, setTahnu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ctlRef = useRef<AbortController | null>(null);

  useEffect(() => () => ctlRef.current?.abort(), []);

  const prijmi = async (soubor: File) => {
    if (disabled) return;
    if (!povoleneTypy.has(soubor.type)) {
      setStav({ druh: "chyba", text: t("admin.media.invalidType", { type: soubor.type || "?" }) });
      return;
    }
    if (soubor.size > maxBytes) {
      setStav({ druh: "chyba", text: t("admin.media.tooLarge", { mb: Math.round(maxBytes / 1024 / 1024) }) });
      return;
    }
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setStav({ druh: "nahravam", podil: 0, jmeno: soubor.name });
    try {
      await onFile(soubor, (podil) => setStav({ druh: "nahravam", podil, jmeno: soubor.name }), ctl.signal);
      setStav({ druh: "hotovo", jmeno: soubor.name });
    } catch (err) {
      if (ctl.signal.aborted) {
        setStav({ druh: "klid" });
        return;
      }
      setStav({ druh: "chyba", text: prelozChybu(err, t) });
    } finally {
      ctlRef.current = null;
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const soubor = e.target.files?.[0];
    e.target.value = "";
    if (soubor) void prijmi(soubor);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setTahnu(false);
    const soubor = e.dataTransfer.files?.[0];
    if (soubor) void prijmi(soubor);
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const polozka = Array.from(e.clipboardData.items).find((i) => i.kind === "file");
    const soubor = polozka?.getAsFile();
    if (soubor) {
      e.preventDefault();
      void prijmi(soubor);
    }
  };

  const nahravam = stav.druh === "nahravam";

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={popisek ?? t("admin.media.uploadPick")}
        aria-disabled={disabled}
        onClick={() => !disabled && !nahravam && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled && !nahravam) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setTahnu(true);
        }}
        onDragLeave={() => setTahnu(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        className={cn(
          "rounded-md border border-dashed text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          kompaktni ? "flex items-center gap-3 px-3 py-2" : "flex flex-col items-center justify-center gap-2 px-4 py-6 text-center",
          tahnu ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60",
          (disabled || nahravam) && "cursor-default opacity-70",
          !disabled && !nahravam && "cursor-pointer",
        )}
      >
        <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
        {nahravam ? (
          <div className="flex-1 min-w-0 space-y-1">
            <p className="truncate">{t("admin.media.uploading", { percent: Math.round(stav.podil * 100) })}</p>
            <Progress value={Math.round(stav.podil * 100)} aria-label={stav.jmeno} />
          </div>
        ) : (
          <p className="text-muted-foreground">
            {t("admin.media.uploadDrop")}{" "}
            <span className="font-medium text-foreground underline underline-offset-2">{popisek ?? t("admin.media.uploadPick")}</span>
          </p>
        )}
        {nahravam ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              ctlRef.current?.abort();
            }}
          >
            <X className="h-4 w-4 mr-1" />
            {t("admin.media.cancel")}
          </Button>
        ) : null}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onChange} disabled={disabled} />
      </div>
      {stav.druh === "hotovo" ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("admin.media.uploadDone")} · {stav.jmeno}
        </p>
      ) : null}
      {stav.druh === "chyba" ? (
        <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {stav.text}
        </p>
      ) : null}
      {napoveda ? <p className="text-xs text-muted-foreground">{napoveda}</p> : null}
    </div>
  );
}
