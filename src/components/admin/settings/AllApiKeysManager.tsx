/**
 * All API Keys Manager
 * 
 * Centrální správa API klíčů integrací:
 * - Stripe (platby), Fio (banka)
 * - Packeta (doručení)
 * - Home Assistant (IoT)
 *
 * Klíče poskytovatelů AI (OpenAI, Anthropic, Google, token Claude …) tu NEJSOU — mají
 * vlastní sekci „Poskytovatelé AI a tokeny" (ProviderCredentialsManager), jejíž seznam
 * je odvozený z DB. Dosavadní `openai_api_key` přejmenuje heals do nového domova.
 * 
 * Všechny klíče se ukládají šifrovaně do trezoru (set_api_key_admin → vault.secrets); nešifrovaná kopie v `app_secrets` se od 2026-09-28 nezapisuje.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Key, Eye, EyeOff, Check, AlertTriangle, RefreshCw, CreditCard, Truck, Cable, Landmark, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAllApiKeyStatus, useSaveApiKey } from "@/hooks/useAdminApiKeys";
import type { ApiKeyStatus } from "@/hooks/useAdminApiKeys";
import { fetchHomeAssistantHealth } from "@/hooks/useHomeAssistantProductionSync";

// Definice API klíčů které spravujeme
const API_KEY_CONFIGS = {
  stripe_secret: {
    key: "stripe_secret_key",
    label: "Stripe Secret Key",
    icon: CreditCard,
    placeholder: "sk_live_... nebo sk_test_...",
    description: "Secret key pro platební operace (server-side)",
  },
  stripe_publishable: {
    key: "stripe_publishable_key",
    label: "Stripe Publishable Key",
    icon: CreditCard,
    placeholder: "pk_live_... nebo pk_test_...",
    description: "Publishable key pro checkout (client-side)",
  },
  stripe_webhook_secret: {
    key: "stripe_webhook_secret",
    label: "Stripe Webhook Secret",
    icon: CreditCard,
    placeholder: "whsec_...",
    description: "Secret pro ověření webhook podpisů",
  },
  packeta_api_key: {
    key: "packeta_api_key",
    label: "Packeta API Key",
    icon: Truck,
    placeholder: "API klíč z Packeta administrace",
    description: "Hlavní API klíč pro Packeta/Zásilkovna",
  },
  packeta_api_password: {
    key: "packeta_api_password",
    label: "Packeta API Password",
    icon: Truck,
    placeholder: "Heslo k API",
    description: "Heslo/password pro Packeta API",
  },
  packeta_sender_id: {
    key: "packeta_sender_id",
    label: "Packeta Sender ID",
    icon: Truck,
    placeholder: "Sender ID",
    description: "ID odesílatele pro vytváření zásilek",
  },
  homeassistant_base_url: {
    key: "homeassistant_base_url",
    label: "Home Assistant URL",
    icon: Cable,
    placeholder: "http://homeassistant.local:8123",
    description: "Base URL vaší Home Assistant instance",
  },
  homeassistant_access_token: {
    key: "homeassistant_access_token",
    label: "Home Assistant Access Token",
    icon: Cable,
    placeholder: "Long-lived access token",
    description: "Long-lived access token z Home Assistant (Profil → Security)",
  },
  fio_bank_api_token: {
    key: "fio_bank_api_token",
    label: "Fio Banka API Token",
    icon: Landmark,
    placeholder: "Token z internetového bankovnictví Fio",
    description: "API token pro automatický import transakcí z Fio banky",
  },
} as const;

type ApiKeyType = keyof typeof API_KEY_CONFIGS;

function ApiKeyEditor({ 
  keyType, 
  status, 
  onSave 
}: { 
  keyType: ApiKeyType; 
  status: ApiKeyStatus | undefined;
  onSave: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const config = API_KEY_CONFIGS[keyType];
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    
    setIsSaving(true);
    try {
      await onSave(value);
      setValue("");
      toast.success(t("admin.settings.apiKeySaved", { key: config.label }), {
        description: t("admin.settings.apiKeySavedDescription"),
      });
    } catch {
      toast.error(t("common.error"), {
        description: t("admin.settings.apiKeySaveError"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isConfigured = status?.isSet ?? false;
  const Icon = config.icon;

  return (
    <div className="space-y-3 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <Label className="font-medium">{config.label}</Label>
        </div>
        {isConfigured ? (
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
      
      <p className="text-sm text-muted-foreground">{config.description}</p>
      
      {status?.maskedValue && (
        <div className="text-xs font-mono bg-muted px-2 py-1 rounded">
          {status.maskedValue}
        </div>
      )}
      
      {status?.updatedAt && (
        <div className="text-xs text-muted-foreground">
          {t("admin.settings.lastUpdated")}: {new Date(status.updatedAt).toLocaleString()}
        </div>
      )}
      
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showValue ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={config.placeholder}
            className="pr-10 font-mono text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full"
            onClick={() => setShowValue(!showValue)}
          >
            {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <Button
          onClick={handleSave}
          disabled={!value.trim() || isSaving}
        >
          {isSaving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function HaConnectionTest() {
  const { t } = useTranslation();
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await fetchHomeAssistantHealth();
      if (result.success) {
        toast.success(t("admin.settings.connectionSuccess"), {
          description: result.ha_version
            ? `Home Assistant ${result.ha_version} (${result.transport ?? "rest"})`
            : t("admin.settings.connectionSuccess"),
        });
      } else {
        toast.error(t("admin.settings.connectionFailed"), {
          description: "Health check returned success=false",
        });
      }
    } catch (err) {
      toast.error(t("admin.settings.connectionFailed"), {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
      {isTesting ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Cable className="h-4 w-4 mr-2" />
      )}
      {t("admin.settings.testConnection")}
    </Button>
  );
}

export function AllApiKeysManager() {
  const { t } = useTranslation();
  const { data: statusMap, isLoading, refetch } = useAllApiKeyStatus();
  const saveMutation = useSaveApiKey();

  const handleSave = async (keyType: ApiKeyType, value: string) => {
    const config = API_KEY_CONFIGS[keyType];
    await saveMutation.mutateAsync({ keyName: config.key, value });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {t("admin.settings.apiKeysManagement")}
            </CardTitle>
            <CardDescription>
              {t("admin.settings.apiKeysDescription")}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t("admin.settings.apiKeysWarning")}
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="payments" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="payments" className="gap-2">
                <CreditCard className="h-4 w-4" />
                {t("admin.settings.payments")}
              </TabsTrigger>
              <TabsTrigger value="shipping" className="gap-2">
                <Truck className="h-4 w-4" />
                {t("admin.settings.shipping")}
              </TabsTrigger>
              <TabsTrigger value="iot" className="gap-2">
                <Cable className="h-4 w-4" />
                {t("admin.settings.iot")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="payments" className="space-y-4 mt-4">
              <ApiKeyEditor
                keyType="stripe_secret"
                status={statusMap?.stripe_secret_key}
                onSave={(value) => handleSave("stripe_secret", value)}
              />
              <ApiKeyEditor
                keyType="stripe_publishable"
                status={statusMap?.stripe_publishable_key}
                onSave={(value) => handleSave("stripe_publishable", value)}
              />
              <ApiKeyEditor
                keyType="stripe_webhook_secret"
                status={statusMap?.stripe_webhook_secret}
                onSave={(value) => handleSave("stripe_webhook_secret", value)}
              />
              <ApiKeyEditor
                keyType="fio_bank_api_token"
                status={statusMap?.fio_bank_api_token}
                onSave={(value) => handleSave("fio_bank_api_token", value)}
              />
            </TabsContent>

            <TabsContent value="shipping" className="space-y-4 mt-4">
              <ApiKeyEditor
                keyType="packeta_api_key"
                status={statusMap?.packeta_api_key}
                onSave={(value) => handleSave("packeta_api_key", value)}
              />
              <ApiKeyEditor
                keyType="packeta_api_password"
                status={statusMap?.packeta_api_password}
                onSave={(value) => handleSave("packeta_api_password", value)}
              />
              <ApiKeyEditor
                keyType="packeta_sender_id"
                status={statusMap?.packeta_sender_id}
                onSave={(value) => handleSave("packeta_sender_id", value)}
              />
            </TabsContent>

            <TabsContent value="iot" className="space-y-4 mt-4">
              <ApiKeyEditor
                keyType="homeassistant_base_url"
                status={statusMap?.homeassistant_base_url}
                onSave={(value) => handleSave("homeassistant_base_url", value)}
              />
              <ApiKeyEditor
                keyType="homeassistant_access_token"
                status={statusMap?.homeassistant_access_token}
                onSave={(value) => handleSave("homeassistant_access_token", value)}
              />
              <div className="flex justify-end pt-2">
                <HaConnectionTest />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
