import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, History, Info, QrCode, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useNahratAppku,
  useNahratHlidace,
  useUlozitZadost,
  useZadostiHlidace,
  useZarizeniKonfigurace,
  type ZadostHlidace,
} from "@/hooks/useZarizeniHlidac";
import { NahravaciPole } from "@/components/admin/media/NahravaciPole";
import { NavodTablety } from "@/components/admin/devices/NavodTablety";
import { PrehledZarizeni } from "@/components/admin/devices/PrehledZarizeni";
import { MIN_DELKA_PINU, obsahQr, platneOkno, platnyPin, zaznamPinu, type WifiNastaveni } from "@/lib/zarizeni/qrHlidace";

/**
 * Tablety s hlídačem: nahrání hlídače a QR pro nastavení tabletu.
 *
 * Volitelná schopnost instance — kde není zapnutá, panel to řekne a nic
 * nenabízí. PIN technika se zpracuje jen tady v prohlížeči (do QR jde otisk)
 * a nikam se neukládá: je to jediná cesta z kiosku ven.
 *
 * Každý vyrobený QR se uloží jako ŽÁDOST (kdy, kdo, síť, okno, poznámka) a dá
 * se vzít jako vzor pro další tablet. Tajemství — PIN ani heslo k Wi-Fi — se
 * neukládají; server tělo, které je nese, odmítne.
 */
/** Server přijímá jen balíček Androidu; strop drží storage-auth (`maxApkMb`). */
const APK_TYPY = new Set(["application/vnd.android.package-archive"]);
const MAX_APK_BYTES = 20 * 1024 * 1024;

export function TabletyPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useZarizeniKonfigurace();
  const zadosti = useZadostiHlidace(Boolean(data?.zapnuto));
  const ulozitZadost = useUlozitZadost();
  const nahrat = useNahratHlidace();
  const nahratAppku = useNahratAppku();
  const [pin, setPin] = useState("");
  const [pinZnovu, setPinZnovu] = useState("");
  const [ssid, setSsid] = useState("");
  const [heslo, setHeslo] = useState("");
  const [zabezpeceni, setZabezpeceni] = useState<NonNullable<WifiNastaveni["zabezpeceni"]>>("WPA");
  const [okno, setOkno] = useState("02:00-04:00");
  const [poznamka, setPoznamka] = useState("");
  const [predloha, setPredloha] = useState<ZadostHlidace | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [vyrabim, setVyrabim] = useState(false);

  if (isLoading) return <div className="h-32 flex items-center justify-center text-muted-foreground">{t("admin.devices.loading")}</div>;
  // ⛔ Jen když data NEJSOU. TanStack po neúspěšném obnovení na pozadí nastaví
  //    `isError` i nad existujícími daty (naměřeno 5.100) — a dřívější
  //    `isError || !data` tím schoval celý panel i s vyrobeným QR. Slabší signál
  //    nebo vypršelý token tak technikovi „smazal" QR uprostřed nastavování.
  if (!data) return <div className="h-32 flex items-center justify-center text-destructive">{t("admin.devices.tablets.loadError")}</div>;

  if (!data.zapnuto) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t("admin.devices.tablets.off.title")}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t("admin.devices.tablets.off.body")}</p>
          {data.chyba ? <p className="text-destructive">{t("admin.devices.tablets.off.invalid", { reason: data.chyba })}</p> : null}
        </AlertDescription>
      </Alert>
    );
  }

  const { hlidac, stazeni, apk, appky } = data;
  const pinOk = platnyPin(pin) && pin === pinZnovu;
  const oknoOk = platneOkno(okno);
  const lzeVyrobit = Boolean(apk && stazeni && pinOk && oknoOk) && !vyrabim;

  // Průběh a lidské hlášky (otisk sha256 z deklarace) dělá společné nahrávací
  // pole (2026-09-24); chybový kód ze serveru nese ChybaNahraniHlidace.kod.
  const nahrajApk = async (soubor: File, onProgress: (podil: number) => void, signal: AbortSignal) => {
    await nahrat.mutateAsync({ soubor, onProgress, signal });
    toast.success(t("admin.devices.tablets.apk.uploaded"));
  };

  const onSouborAppky = (balicek: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const soubor = e.target.files?.[0];
    e.target.value = "";
    if (!soubor) return;
    nahratAppku.mutate(
      { balicek, soubor },
      {
        onSuccess: () => toast.success(t("admin.devices.tablets.apps.uploaded", { pkg: balicek })),
        onError: (err) => toast.error(t("admin.devices.tablets.apps.uploadFailed", { pkg: balicek, reason: err.message })),
      },
    );
  };

  const vyrobQr = async () => {
    if (!stazeni) return;
    setVyrabim(true);
    try {
      const obsah = obsahQr({
        konfigurace: hlidac,
        stazeni,
        pinZaznam: await zaznamPinu(pin),
        okno,
        wifi: ssid ? { ssid, heslo: heslo || undefined, zabezpeceni } : null,
      });
      setQr(JSON.stringify(obsah));
      // PIN se po výrobě QR v prohlížeči nedrží.
      setPin("");
      setPinZnovu("");
      // Stopa + vzor pro další tablet. QR platí i tehdy, když se uložit nepovede —
      // záznam je vedlejší, nastavení tabletu na něm nesmí viset.
      ulozitZadost.mutate(
        { poznamka: poznamka.trim() || null, sit: ssid ? { ssid, zabezpeceni } : null, okno },
        { onError: (err) => toast.error(t("admin.devices.tablets.qr.saveFailed", { reason: err.message })) },
      );
    } catch (err) {
      toast.error(t("admin.devices.tablets.qr.failed", { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setVyrabim(false);
    }
  };

  const pouzitVzor = (z: ZadostHlidace) => {
    setSsid(z.sit?.ssid ?? "");
    setZabezpeceni(z.sit?.zabezpeceni ?? "WPA");
    setOkno(z.okno);
    // Poznámka patří JEDNOMU tabletu — z předlohy se nepřebírá.
    setPoznamka("");
    setHeslo("");
    setPin("");
    setPinZnovu("");
    setQr(null);
    setPredloha(z);
    toast.info(t("admin.devices.tablets.requests.templateApplied", { date: new Date(z.vytvoreno).toLocaleString() }));
  };

  return (
    <div className="space-y-6">
      {isError ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t("admin.devices.tablets.loadStale")}</AlertDescription>
        </Alert>
      ) : null}
      <PrehledZarizeni zapnuto={data.zapnuto} />
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.devices.tablets.apk.title")}</CardTitle>
          <CardDescription>
            {t("admin.devices.tablets.apk.identity", {
              pkg: hlidac.applicationId,
              version: `${hlidac.versionName} (${hlidac.versionCode})`,
              kiosk: hlidac.kioskPackage,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {apk ? (
            <p className="text-sm">
              {t("admin.devices.tablets.apk.present", {
                kb: Math.ceil(apk.bajtu / 1024),
                date: new Date(apk.nahrano).toLocaleString(),
                sha: apk.sha256 ? apk.sha256.slice(0, 12) : "?",
              })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.devices.tablets.apk.missing")}</p>
          )}
          <NahravaciPole
            povoleneTypy={APK_TYPY}
            accept=".apk,application/vnd.android.package-archive"
            maxBytes={MAX_APK_BYTES}
            kompaktni
            popisek={t("admin.devices.tablets.apk.upload")}
            onFile={nahrajApk}
          />
          <p className="text-xs text-muted-foreground">{t("admin.devices.tablets.apk.signatureNote", { cert: hlidac.certSha256 })}</p>
          {!stazeni ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t("admin.devices.tablets.noPublicUrl")}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {appky && appky.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              {t("admin.devices.tablets.apps.title")}
            </CardTitle>
            <CardDescription>{t("admin.devices.tablets.apps.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {appky.map((a) => (
              <div key={a.balicek} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {a.balicek} · {a.versionName} ({a.versionCode})
                </p>
                {/* POZOR: tri stavy, ne dva - "nenahrano" a "nahrano neco jineho" se resi jinak. */}
                {a.stav === "drzi" ? (
                  <p className="text-sm">
                    {t("admin.devices.tablets.apps.present", {
                      mb: Math.ceil((a.bajtuVUlozisti ?? 0) / 1024 / 1024),
                      date: a.nahrano ? new Date(a.nahrano).toLocaleString() : "?",
                    })}
                  </p>
                ) : a.stav === "nesedi" ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{t("admin.devices.tablets.apps.mismatch", { sha: a.sha256.slice(0, 12) })}</AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("admin.devices.tablets.apps.missing", { sha: a.sha256.slice(0, 12) })}</p>
                )}
                <div className="flex items-center gap-3">
                  <Label
                    htmlFor={`appka-${a.balicek}`}
                    className="cursor-pointer inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Upload className="h-4 w-4" />
                    {nahratAppku.isPending ? t("admin.devices.tablets.apps.uploading") : t("admin.devices.tablets.apps.upload")}
                  </Label>
                  <Input
                    id={`appka-${a.balicek}`}
                    type="file"
                    accept=".apk,application/vnd.android.package-archive"
                    className="hidden"
                    onChange={onSouborAppky(a.balicek)}
                    disabled={nahratAppku.isPending}
                  />
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t("admin.devices.tablets.apps.note")}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            {t("admin.devices.tablets.qr.title")}
          </CardTitle>
          <CardDescription>{t("admin.devices.tablets.qr.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pin">{t("admin.devices.tablets.qr.pin")}</Label>
              <Input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.trim())} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pin2">{t("admin.devices.tablets.qr.pinAgain")}</Label>
              <Input id="pin2" type="password" inputMode="numeric" autoComplete="off" value={pinZnovu} onChange={(e) => setPinZnovu(e.target.value.trim())} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ssid">{t("admin.devices.tablets.qr.ssid")}</Label>
              <Input id="ssid" autoComplete="off" value={ssid} onChange={(e) => setSsid(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wifi-heslo">{t("admin.devices.tablets.qr.wifiPassword")}</Label>
              <Input id="wifi-heslo" type="password" autoComplete="off" value={heslo} onChange={(e) => setHeslo(e.target.value)} disabled={!ssid} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wifi-zab">{t("admin.devices.tablets.qr.wifiSecurity")}</Label>
              <select
                id="wifi-zab"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={zabezpeceni}
                onChange={(e) => setZabezpeceni(e.target.value as typeof zabezpeceni)}
                disabled={!ssid}
              >
                <option value="WPA">WPA/WPA2</option>
                <option value="WEP">WEP</option>
                <option value="NONE">{t("admin.devices.tablets.qr.wifiOpen")}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="okno">{t("admin.devices.tablets.qr.window")}</Label>
              <Input id="okno" value={okno} onChange={(e) => setOkno(e.target.value.trim())} aria-invalid={!oknoOk} />
              {oknoOk ? null : <p className="text-sm text-destructive">{t("admin.devices.tablets.qr.windowInvalid")}</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="poznamka">{t("admin.devices.tablets.qr.note")}</Label>
              <Input
                id="poznamka"
                maxLength={200}
                autoComplete="off"
                placeholder={t("admin.devices.tablets.qr.notePlaceholder")}
                value={poznamka}
                onChange={(e) => setPoznamka(e.target.value)}
              />
            </div>
          </div>
          {predloha ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.devices.tablets.qr.fromTemplate", { date: new Date(predloha.vytvoreno).toLocaleString() })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("admin.devices.tablets.qr.pinNote", { min: MIN_DELKA_PINU })}</p>
          <div className="flex gap-2">
            <Button onClick={vyrobQr} disabled={!lzeVyrobit}>
              {vyrabim ? t("admin.devices.tablets.qr.creating") : t("admin.devices.tablets.qr.create")}
            </Button>
            {qr ? (
              <Button variant="outline" onClick={() => setQr(null)}>
                {t("admin.devices.tablets.qr.clear")}
              </Button>
            ) : null}
          </div>
          {!apk ? <p className="text-sm text-muted-foreground">{t("admin.devices.tablets.qr.needApk")}</p> : null}
          {qr ? (
            <div className="space-y-3">
              <div className="inline-block rounded-md bg-white p-4">
                <QRCodeSVG value={qr} size={360} level="M" />
              </div>
              <ol className="list-decimal pl-5 text-sm space-y-1">
                <li>{t("admin.devices.tablets.qr.step1")}</li>
                <li>{t("admin.devices.tablets.qr.step2")}</li>
                <li>{t("admin.devices.tablets.qr.step3")}</li>
                <li>{t("admin.devices.tablets.qr.step4")}</li>
              </ol>
              {ssid ? <p className="text-xs text-destructive">{t("admin.devices.tablets.qr.wifiWarning")}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            {t("admin.devices.tablets.requests.title")}
          </CardTitle>
          <CardDescription>{t("admin.devices.tablets.requests.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {zadosti.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("admin.devices.loading")}</p>
          ) : !zadosti.data ? (
            <p className="text-sm text-destructive">{t("admin.devices.tablets.requests.loadError")}</p>
          ) : zadosti.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.devices.tablets.requests.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.when")}</th>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.note")}</th>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.network")}</th>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.window")}</th>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.who")}</th>
                    <th className="py-2 pr-3 font-medium">{t("admin.devices.tablets.requests.version")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {zadosti.data.map((z) => (
                    <tr key={z.id} className="border-t">
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{new Date(z.vytvoreno).toLocaleString()}</td>
                      <td className="py-2 pr-3">{z.poznamka ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {z.sit ? `${z.sit.ssid} (${z.sit.zabezpeceni})` : t("admin.devices.tablets.requests.noWifi")}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{z.okno}</td>
                      <td className="py-2 pr-3">{z.autor}</td>
                      <td className="py-2 pr-3 tabular-nums">{z.hlidac.versionCode}</td>
                      <td className="py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => pouzitVzor(z)}>
                          {t("admin.devices.tablets.requests.useAsTemplate")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <NavodTablety kiosk={hlidac.kioskPackage} okno={okno} />
    </div>
  );
}
