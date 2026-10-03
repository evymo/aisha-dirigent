import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Tablet, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHlaseniZarizeni, type CilovaVerze, type HlaseniTabletu } from "@/hooks/useZarizeniHlidac";
import { celkem, mlci, stavBalicku, type StavBalicku } from "@/lib/zarizeni/stavZarizeni";

/**
 * Přehled zařízení: co tablety samy hlásí (Kiosk Admin po rozdávání, instalaci
 * a startu) proti tomu, co na nich má být podle deklarace instance.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-28): „chceme v administraci přehled instalovaných
 * zařízení i s informací o stavu instalace." Hlášení je INFORMACE, ne identita —
 * schválení tabletu a jeho práva jsou F1 (průkaz zařízení).
 */
export function PrehledZarizeni({ zapnuto }: { zapnuto: boolean }) {
  const { t } = useTranslation();
  const q = useHlaseniZarizeni(zapnuto);
  const ted = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tablet className="w-5 h-5" />
          {t("admin.devices.tablets.devices.title")}
        </CardTitle>
        <CardDescription>{t("admin.devices.tablets.devices.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("admin.devices.loading")}</p>
        ) : !q.data ? (
          <p className="text-sm text-destructive">{t("admin.devices.tablets.devices.loadError")}</p>
        ) : q.data.zarizeni.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.devices.tablets.devices.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.devices.device")}</th>
                  <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.devices.kioskAdmin")}</th>
                  <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.devices.apps")}</th>
                  <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.devices.webview")}</th>
                  <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.devices.state")}</th>
                  <th className="py-2 font-medium">{t("admin.devices.tablets.devices.seen")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.zarizeni.map((h) => (
                  <Radek key={h.zarizeni} h={h} appky={q.data.appky} kioskAdmin={q.data.kioskAdmin} ted={ted} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Radek({ h, appky, kioskAdmin, ted }: { h: HlaseniTabletu; appky: CilovaVerze[]; kioskAdmin: CilovaVerze; ted: Date }) {
  const { t } = useTranslation();
  const stavKa = stavBalicku(h.kioskAdmin.versionCode, kioskAdmin.versionCode);
  const stavyAppek = appky.map((a) => ({ a, stav: stavBalicku(h.appky.find((x) => x.balicek === a.balicek)?.versionCode, a.versionCode) }));
  const vsechno = celkem([stavKa, ...stavyAppek.map((x) => x.stav)]);
  const ticho = mlci(h.prijato, ted);
  return (
    <tr className="border-t align-top" data-stav={vsechno}>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <Znacka stav={vsechno} />
          <span>{h.model}</span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {h.zarizeni.slice(0, 8)} · Android {h.android} · {h.rezim === "servis" ? t("admin.devices.tablets.devices.modeService") : t("admin.devices.tablets.devices.modeKiosk")}
        </div>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <Verze stav={stavKa} ma={`${h.kioskAdmin.versionName} (${h.kioskAdmin.versionCode})`} cil={kioskAdmin} />
      </td>
      <td className="py-2 pr-3">
        {stavyAppek.map(({ a, stav }) => {
          const ma = h.appky.find((x) => x.balicek === a.balicek);
          return (
            <div key={a.balicek} className="whitespace-nowrap">
              <span className="text-muted-foreground">{a.balicek}: </span>
              <Verze stav={stav} ma={ma && ma.versionCode >= 0 ? String(ma.versionCode) : null} cil={a} />
            </div>
          );
        })}
      </td>
      <td className="py-2 pr-3">
        {h.webview ? (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            {h.webview}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-destructive">
            <XCircle className="w-4 h-4" />
            {t("admin.devices.tablets.devices.noWebview")}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 max-w-xs break-words">{h.stav || "—"}</td>
      <td className="py-2 whitespace-nowrap tabular-nums">
        <div>{new Date(h.prijato).toLocaleString()}</div>
        {ticho ? <div className="text-xs text-destructive">{t("admin.devices.tablets.devices.silent")}</div> : null}
      </td>
    </tr>
  );
}

function Verze({ stav, ma, cil }: { stav: StavBalicku; ma: string | null; cil: CilovaVerze }) {
  const { t } = useTranslation();
  if (stav === "chybi") return <span className="text-destructive">{t("admin.devices.tablets.devices.missing")}</span>;
  if (stav === "starsi") {
    return (
      <span className="text-amber-600">
        {ma} · {t("admin.devices.tablets.devices.outdated", { version: `${cil.versionName} (${cil.versionCode})` })}
      </span>
    );
  }
  return <span>{ma}</span>;
}

function Znacka({ stav }: { stav: StavBalicku }) {
  if (stav === "aktualni") return <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden />;
  if (stav === "starsi") return <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden />;
  return <XCircle className="w-4 h-4 text-destructive" aria-hidden />;
}
