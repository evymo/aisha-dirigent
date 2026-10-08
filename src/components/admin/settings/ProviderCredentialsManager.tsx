/**
 * Poskytovatelé AI a tokeny — správa pověření instance.
 *
 * Každý fork AISHY je vlastní instance s vlastním trezorem: tady si správa nastaví
 * SVOJE tokeny a API klíče (Anthropic, OpenAI, Google, token Claude pro runner …).
 * Seznam není v kódu — je to katalog odvozený z DB (co deklarují poskytovatelé,
 * runtime a MCP servery). Hodnota se jen zapisuje: zpátky se nikdy nečte ani
 * nezobrazuje, ani její část.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type ProviderCredential,
  useDeleteProviderCredential,
  useProviderCredentials,
  useSetProviderCredential,
} from "@/hooks/useProviderCredentials";

function CredentialRow({ credential }: { credential: ProviderCredential }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setMutation = useSetProviderCredential();
  const deleteMutation = useDeleteProviderCredential();
  const isOrphan = credential.usedBy.length === 0;
  // Druh deklarace je uzavřená osa katalogu (provider_credential_catalog): poskytovatel,
  // runtime, MCP server. Neznámý druh se ukáže tak, jak ho DB vrátila.
  const kindLabel = (kind: string): string =>
    kind === "provider"
      ? t("admin.settings.providerCredentials.kind.provider")
      : kind === "runtime"
        ? t("admin.settings.providerCredentials.kind.runtime")
        : kind === "mcp_server"
          ? t("admin.settings.providerCredentials.kind.mcp_server")
          : kind;
  const inputId = `provider-credential-${credential.envVar}`;

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await setMutation.mutateAsync({ envVar: credential.envVar, value: trimmed });
      setValue("");
      toast.success(t("admin.settings.providerCredentials.saved", { name: credential.envVar }));
    } catch {
      toast.error(t("admin.settings.providerCredentials.saveError", { name: credential.envVar }));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ envVar: credential.envVar });
      toast.success(t("admin.settings.providerCredentials.deleted", { name: credential.envVar }));
    } catch {
      toast.error(t("admin.settings.providerCredentials.deleteError", { name: credential.envVar }));
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid={`provider-credential-${credential.envVar}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${inputId}-name`} className="font-mono text-sm font-medium">
          {credential.envVar}
        </span>
        {credential.isSet ? (
          <Badge variant="default" className="gap-1">
            <Check className="h-3 w-3" />
            {t("admin.settings.configured")}
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {t("admin.settings.notConfigured")}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {isOrphan ? (
          <span>{t("admin.settings.providerCredentials.orphan")}</span>
        ) : (
          <>
            <span>{t("admin.settings.providerCredentials.usedBy")}:</span>
            {credential.usedBy.map((u) => (
              <Badge key={`${u.kind}:${u.slug}`} variant="outline" className="font-normal">
                {u.displayName}
                <span className="ml-1 text-muted-foreground">({kindLabel(u.kind)})</span>
              </Badge>
            ))}
          </>
        )}
      </div>

      {credential.isSet && (
        <div className="text-xs text-muted-foreground">
          {credential.source === "env"
            ? t("admin.settings.providerCredentials.sourceEnv")
            : credential.source === "admin"
              ? t("admin.settings.providerCredentials.sourceAdmin")
              : null}
          {credential.updatedAt && (
            <span className="ml-2">
              {t("admin.settings.lastUpdated")}: {new Date(credential.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!isOrphan && (
          <>
            <Input
              id={inputId}
              aria-labelledby={`${inputId}-name`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("admin.settings.providerCredentials.placeholder")}
              className="min-w-[16rem] flex-1 font-mono text-sm"
            />
            <Button onClick={handleSave} disabled={!value.trim() || setMutation.isPending}>
              {setMutation.isPending
                ? t("common.saving")
                : credential.isSet
                  ? t("admin.settings.providerCredentials.replace")
                  : t("admin.settings.providerCredentials.set")}
            </Button>
          </>
        )}
        {credential.isSet && (
          <Button
            variant="outline"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            aria-label={t("admin.settings.providerCredentials.deleteAria", { name: credential.envVar })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.settings.providerCredentials.deleteConfirmTitle", { name: credential.envVar })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.settings.providerCredentials.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ProviderCredentialsManager() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useProviderCredentials();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t("admin.settings.providerCredentials.title")}
            </CardTitle>
            <CardDescription>{t("admin.settings.providerCredentials.description")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t("admin.settings.providerCredentials.warning")}</AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("admin.settings.providerCredentials.loadError")}</AlertDescription>
          </Alert>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.settings.providerCredentials.empty")}</p>
        ) : (
          data.map((credential) => <CredentialRow key={credential.envVar} credential={credential} />)
        )}
      </CardContent>
    </Card>
  );
}
