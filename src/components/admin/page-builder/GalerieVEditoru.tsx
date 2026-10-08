/**
 * Správce obrázků editoru = galerie nahraných médií (2026-10-03, naměřeno na instanci).
 *
 * ⛔ CO SE NAMĚŘILO: výchozí správce obrázků GrapesJS ukazuje jen obrázky, které
 * dostal při startu editoru (`AssetManager.add` v `onEditor`, volaném JEDNOU).
 * Editor webových stránek nedostal žádné — správce webu tak nemohla vybrat nic,
 * co už bylo nahrané. U článků se knihovna načítala souběžně se startem editoru
 * a co nedoběhlo včas, ve správci chybělo; navíc jen posledních 60 bez hledání.
 *
 * Přes `AssetsProvider` (@grapesjs/react) se místo výchozího správce otevře
 * galerie s hledáním, náhledy a nahráním (antivirus, evidence `media_assets`):
 * dvojklik na obrázek na plátně i výběr obrázku pozadí ve stylech.
 */
import { AssetsProvider, useEditor, type AssetsResultProps } from "@grapesjs/react";
import type { Asset } from "grapesjs";
import { GalerieMedii } from "@/components/admin/media/GalerieMedii";

export interface MostGalerieProps extends Pick<AssetsResultProps, "open" | "select" | "close"> {
  /** Zaregistruje adresu jako obrázek editoru a vrátí ho (editor.Assets.add). */
  pridej: (src: string) => Asset;
}

/** Most mezi galerií a správcem obrázků editoru — bez kontextu editoru, kvůli testu. */
export function MostGalerie({ open, select, close, pridej }: MostGalerieProps) {
  return (
    <GalerieMedii
      open={open}
      onOpenChange={(otevreno) => {
        if (!otevreno) close();
      }}
      // `complete = true`: obrázek na plátně dostane `src` a správce se zavře
      // (týž význam jako dvojklik ve výchozím správci GrapesJS).
      onPick={(url) => select(pridej(url), true)}
    />
  );
}

function MostSEditorem(props: Pick<AssetsResultProps, "open" | "select" | "close">) {
  const editor = useEditor();
  const pridej = (src: string): Asset => {
    const vysledek = editor.Assets.add({ src });
    return Array.isArray(vysledek) ? vysledek[0] : vysledek;
  };
  return <MostGalerie {...props} pridej={pridej} />;
}

/**
 * Patří DOVNITŘ `<GjsEditor>` hned od prvního vykreslení: `AssetsProvider` si při
 * připojení zapne `assetManager.custom` a editor tu volbu čte jen při vzniku.
 */
export function GalerieVEditoru() {
  return (
    <AssetsProvider>
      {({ open, select, close }) => <MostSEditorem open={open} select={select} close={close} />}
    </AssetsProvider>
  );
}
