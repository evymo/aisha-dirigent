import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Settings,
  Plus,
  Save,
  History,
  BarChart3,
  MessageSquare,
  Play,
  Pause,
  Copy,
  ExternalLink,
  Bot,
  GitBranch,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import {
  usePublicChatChannels,
  useUpsertPublicChatChannel,
  useToggleChannelStatus,
  usePublicChatSessions,
  usePublicChatChannelHistory,
  type PublicChatChannel,
  type ChannelUpsertInput,
} from "@/hooks/usePublicChatChannels";
import { useAvailableModels } from "@/hooks/useAvailableModels";
import { useAgentCatalog } from "@/hooks/useAgentCatalog";

const CHANNEL_TYPE_VALUES = [
  "web_widget",
  "whatsapp",
  "telegram",
  "messenger",
  "email",
  "api",
] as const;

/** Default model — matches DB schema default for public_chat_channels.model */
const DEFAULT_MODEL = import.meta.env.VITE_DEFAULT_CHAT_MODEL ?? "gpt-4o-mini";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  paused: "bg-orange-100 text-orange-800",
  archived: "bg-gray-100 text-gray-800",
};

export default function AdminPublicChat() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const { data: channels, isLoading } = usePublicChatChannels();
  const { data: modelsData, isLoading: modelsLoading } = useAvailableModels();
  const { data: catalogAgents } = useAgentCatalog();
  const upsertChannel = useUpsertPublicChatChannel();
  const toggleStatus = useToggleChannelStatus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editForm, setEditForm] = useState<ChannelUpsertInput | null>(null);
  const [changeSummary, setChangeSummary] = useState("");

  const selectedChannel = channels?.find((c) => c.id === selectedId);
  const { data: sessions } = usePublicChatSessions(selectedId ?? undefined);
  const { data: history } = usePublicChatChannelHistory(selectedId ?? undefined);

  const handleSelect = (channel: PublicChatChannel) => {
    setSelectedId(channel.id);
    setIsCreating(false);
    setEditForm({
      id: channel.id,
      slug: channel.slug,
      display_name: channel.display_name,
      channel_type: channel.channel_type,
      status: channel.status,
      context_profile: channel.context_profile,
      system_prompt: channel.system_prompt,
      model: channel.model,
      temperature: channel.temperature,
      max_tokens: channel.max_tokens,
      personality_enabled: channel.personality_enabled,
      webhook_url: channel.webhook_url,
      guardrails: channel.guardrails as ChannelUpsertInput["guardrails"],
      routing_rules: channel.routing_rules as ChannelUpsertInput["routing_rules"],
      allowed_tools: channel.allowed_tools as ChannelUpsertInput["allowed_tools"],
      widget_config: channel.widget_config as ChannelUpsertInput["widget_config"],
      lead_capture: channel.lead_capture as ChannelUpsertInput["lead_capture"],
      model_settings: channel.model_settings as ChannelUpsertInput["model_settings"],
      vector_store_config: channel.vector_store_config as ChannelUpsertInput["vector_store_config"],
    });
    setChangeSummary("");
  };

  const handleCreate = () => {
    setSelectedId(null);
    setIsCreating(true);
    setEditForm({
      slug: "",
      display_name: "",
      channel_type: "web_widget",
      status: "draft",
      personality_enabled: true,
      context_profile: "public_chat",
    });
    setChangeSummary("");
  };

  const handleSave = async () => {
    if (!editForm) return;

    if (!editForm.slug || !editForm.display_name) {
      toast.error(t("publicChat.validation.required"));
      return;
    }

    try {
      const channelId = await upsertChannel.mutateAsync({
        ...editForm,
        change_summary: changeSummary || "Configuration updated",
      });

      toast.success(t("publicChat.saved"));
      setIsCreating(false);
      setSelectedId(channelId);
      setChangeSummary("");
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleToggle = async (id: string, currentStatus: string) => {
    try {
      await toggleStatus.mutateAsync({ id, currentStatus });
      toast.success(
        currentStatus === "active"
          ? t("publicChat.paused")
          : t("publicChat.activated"),
      );
    } catch {
      toast.error(t("common.error"));
    }
  };

  const copyEndpoint = (slug: string) => {
    const exampleMsg = "hello";
    const payload = { message: exampleMsg, channel: slug, visitor_id: "test-1" };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success(t("publicChat.endpointCopied"));
  };

  if (!canManage) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            {t("admin.permissions.accessDenied")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-8 w-8" />
            {t("publicChat.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("publicChat.description")}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("publicChat.createChannel")}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{channels?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              {t("publicChat.stats.channels")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {channels?.filter((c) => c.status === "active").length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("publicChat.stats.active")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {channels?.reduce((sum, c) => sum + c.total_sessions, 0) || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("publicChat.stats.sessions")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {channels?.reduce((sum, c) => sum + c.total_messages, 0) || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("publicChat.stats.messages")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("publicChat.channelList")}
            </CardTitle>
            <CardDescription>
              {channels?.length || 0} {t("publicChat.channelsConfigured")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {channels?.map((channel) => (
              <div
                key={channel.id}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedId === channel.id
                    ? "bg-primary/10 border-primary"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleSelect(channel)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {channel.display_name}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{channel.channel_type}</span>
                    <span>·</span>
                    <span>
                      {channel.total_sessions} {t("publicChat.stats.sessions")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={STATUS_COLORS[channel.status] || ""}
                    variant="secondary"
                  >
                    {channel.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(channel.id, channel.status);
                    }}
                  >
                    {channel.status === "active" ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}

            {(!channels || channels.length === 0) && (
              <div className="text-center text-muted-foreground py-8">
                {t("publicChat.noChannels")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel Detail */}
        <Card className="lg:col-span-2">
          {(selectedChannel || isCreating) && editForm ? (
            <Tabs defaultValue="general">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {isCreating
                        ? t("publicChat.createChannel")
                        : editForm.display_name}
                    </CardTitle>
                    <CardDescription>
                      {isCreating
                        ? t("publicChat.createDescription")
                        : `/${editForm.slug}`}
                    </CardDescription>
                  </div>
                  {selectedChannel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyEndpoint(selectedChannel.slug)}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      {t("publicChat.copyEndpoint")}
                    </Button>
                  )}
                </div>
                <TabsList className="flex-wrap">
                  <TabsTrigger value="general">
                    {t("publicChat.tabs.general")}
                  </TabsTrigger>
                  <TabsTrigger value="agent">
                    <Bot className="h-4 w-4 mr-1" />
                    {t("publicChat.tabs.agent")}
                  </TabsTrigger>
                  <TabsTrigger value="guardrails">
                    {t("publicChat.tabs.guardrails")}
                  </TabsTrigger>
                  <TabsTrigger value="routing">
                    {t("publicChat.tabs.routing")}
                  </TabsTrigger>
                  {!isCreating && (
                    <TabsTrigger value="analytics">
                      {t("publicChat.tabs.analytics")}
                    </TabsTrigger>
                  )}
                </TabsList>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* General Tab */}
                <TabsContent value="general" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("publicChat.fields.slug")}</Label>
                      <Input
                        value={editForm.slug || ""}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            slug: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, "-"),
                          })
                        }
                        placeholder={t("publicChat.fields.slugPlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("publicChat.fields.displayName")}</Label>
                      <Input
                        value={editForm.display_name || ""}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            display_name: e.target.value,
                          })
                        }
                        placeholder={t("publicChat.fields.displayNamePlaceholder")}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("publicChat.fields.channelType")}</Label>
                      <Select
                        value={editForm.channel_type || "web_widget"}
                        onValueChange={(v) =>
                          setEditForm({ ...editForm, channel_type: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHANNEL_TYPE_VALUES.map((ct) => (
                            <SelectItem key={ct} value={ct}>
                              {t(`publicChat.channelTypes.${ct}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("publicChat.fields.status")}</Label>
                      <Select
                        value={editForm.status || "draft"}
                        onValueChange={(v) =>
                          setEditForm({ ...editForm, status: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">{t("publicChat.statusOptions.draft")}</SelectItem>
                          <SelectItem value="active">{t("publicChat.statusOptions.active")}</SelectItem>
                          <SelectItem value="paused">{t("publicChat.statusOptions.paused")}</SelectItem>
                          <SelectItem value="archived">{t("publicChat.statusOptions.archived")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.webhookUrl")}</Label>
                    <Input
                      value={editForm.webhook_url || ""}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          webhook_url: e.target.value,
                        })
                      }
                      placeholder="http://localhost:5678/webhook/public-chat"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.webhookUrlHelp")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editForm.personality_enabled ?? true}
                      onCheckedChange={(v) =>
                        setEditForm({ ...editForm, personality_enabled: v })
                      }
                    />
                    <Label>{t("publicChat.fields.personalityEnabled")}</Label>
                  </div>
                </TabsContent>

                {/* Agent Tab */}
                <TabsContent value="agent" className="space-y-4">
                  {/* Catalog Agent Reference (read-only info) */}
                  {catalogAgents && catalogAgents.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        {t("publicChat.fields.catalogAgent")}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {catalogAgents.map((ca) => (
                          <Badge key={ca.id} variant="outline" className="text-xs">
                            {ca.display_name} ({ca.default_model})
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("publicChat.fields.catalogAgentHelp")}
                      </p>
                    </div>
                  )}

                  <Separator />

                  {/* Model Selection */}
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.model")}</Label>
                    {modelsData?.isFallback && (
                      <p className="text-xs text-amber-600">
                        {t("publicChat.fields.modelsFallbackWarning")}
                      </p>
                    )}
                    <Select
                      value={editForm.model || DEFAULT_MODEL}
                      onValueChange={(v) =>
                        setEditForm({
                          ...editForm,
                          model: v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_MODEL}>
                          {DEFAULT_MODEL} ({t("publicChat.fields.modelDefault")})
                        </SelectItem>
                        {modelsLoading ? (
                          <SelectItem value="__loading__" disabled>
                            {t("common.loading")}
                          </SelectItem>
                        ) : (
                          <>
                            {editForm.model &&
                              editForm.model !== DEFAULT_MODEL &&
                              !modelsData?.models.some((m) => m.id === editForm.model) && (
                              <SelectItem key={editForm.model} value={editForm.model}>
                                {editForm.model} ({t("publicChat.fields.modelCustom")})
                              </SelectItem>
                            )}
                            {modelsData?.models.filter((m) => m.id !== DEFAULT_MODEL).map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.id}
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.modelHelp")}
                    </p>
                  </div>

                  {/* Temperature */}
                  <div className="space-y-2">
                    <Label>
                      {t("publicChat.fields.temperature")}:{" "}
                      {(editForm.temperature ?? 0.7).toFixed(2)}
                    </Label>
                    <Slider
                      min={0}
                      max={2}
                      step={0.05}
                      value={[editForm.temperature ?? 0.7]}
                      onValueChange={([v]) =>
                        setEditForm({ ...editForm, temperature: v })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.temperatureHelp")}
                    </p>
                  </div>

                  {/* Max Tokens */}
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.maxTokens")}</Label>
                    <Input
                      type="number"
                      value={editForm.max_tokens ?? ""}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          max_tokens: e.target.value
                            ? parseInt(e.target.value, 10)
                            : undefined,
                        })
                      }
                      placeholder={t("publicChat.fields.maxTokensPlaceholder")}
                    />
                  </div>

                  <Separator />

                  {/* System Prompt */}
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.systemPrompt")}</Label>
                    <Textarea
                      value={editForm.system_prompt || ""}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          system_prompt:
                            e.target.value || "",
                        })
                      }
                      rows={12}
                      className="font-mono text-sm"
                      placeholder={t(
                        "publicChat.fields.systemPromptPlaceholder",
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.systemPromptHelp")}
                    </p>
                  </div>

                  {/* Context Profile */}
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.contextProfile")}</Label>
                    <Input
                      value={editForm.context_profile || "public_chat"}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          context_profile: e.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.contextProfileHelp")}
                    </p>
                  </div>

                  <Separator />
                </TabsContent>

                {/* Guardrails Tab */}
                <TabsContent value="guardrails" className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.guardrailsJson")}</Label>
                    <Textarea
                      value={JSON.stringify(editForm.guardrails || {}, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setEditForm({ ...editForm, guardrails: parsed });
                        } catch {
                          // Allow invalid JSON while typing
                        }
                      }}
                      rows={12}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.guardrailsHelp")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.allowedTools")}</Label>
                    <Textarea
                      value={JSON.stringify(
                        editForm.allowed_tools || [],
                        null,
                        2,
                      )}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setEditForm({ ...editForm, allowed_tools: parsed });
                        } catch {
                          // Allow invalid JSON while typing
                        }
                      }}
                      rows={6}
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.leadCapture")}</Label>
                    <Textarea
                      value={JSON.stringify(
                        editForm.lead_capture || {},
                        null,
                        2,
                      )}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setEditForm({ ...editForm, lead_capture: parsed });
                        } catch {
                          // Allow invalid JSON while typing
                        }
                      }}
                      rows={8}
                      className="font-mono text-sm"
                    />
                  </div>
                </TabsContent>

                {/* Routing Tab */}
                <TabsContent value="routing" className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.routingRules")}</Label>
                    <Textarea
                      value={JSON.stringify(
                        editForm.routing_rules || {},
                        null,
                        2,
                      )}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setEditForm({ ...editForm, routing_rules: parsed });
                        } catch {
                          // Allow invalid JSON while typing
                        }
                      }}
                      rows={16}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("publicChat.fields.routingRulesHelp")}
                    </p>
                  </div>
                </TabsContent>

                {/* Analytics Tab */}
                {!isCreating && (
                  <TabsContent value="analytics" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {selectedChannel?.total_sessions || 0}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("publicChat.stats.totalSessions")}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">
                            {selectedChannel?.total_messages || 0}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("publicChat.stats.totalMessages")}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Recent Sessions */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <MessageSquare className="h-4 w-4" />
                          {t("publicChat.recentSessions")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {sessions && sessions.length > 0 ? (
                          <div className="space-y-2">
                            {sessions.slice(0, 10).map((session) => (
                              <div
                                key={session.id}
                                className="flex items-center justify-between p-2 rounded border text-sm"
                              >
                                <div>
                                  <span className="font-mono text-xs">
                                    {session.visitor_id}
                                  </span>
                                  <span className="ml-2 text-muted-foreground">
                                    {session.message_count} {t("publicChat.messagesShort")}
                                  </span>
                                </div>
                                <Badge
                                  variant={
                                    session.status === "active"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {session.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            {t("publicChat.noSessions")}
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Config History */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <History className="h-4 w-4" />
                          {t("publicChat.configHistory")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {history && history.length > 0 ? (
                          <div className="space-y-2">
                            {history.slice(0, 10).map((entry) => (
                              <div
                                key={entry.id}
                                className="flex items-center justify-between p-2 rounded border text-sm"
                              >
                                <div>
                                  <span className="font-medium">
                                    v{entry.version}
                                  </span>
                                  <span className="ml-2 text-muted-foreground">
                                    {entry.change_summary}
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(entry.changed_at).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            {t("publicChat.noHistory")}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                <Separator />

                {/* Save section */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>{t("publicChat.fields.changeSummary")}</Label>
                    <Input
                      value={changeSummary}
                      onChange={(e) => setChangeSummary(e.target.value)}
                      placeholder={t(
                        "publicChat.fields.changeSummaryPlaceholder",
                      )}
                    />
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={upsertChannel.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isCreating
                      ? t("publicChat.create")
                      : t("publicChat.save")}
                  </Button>
                </div>
              </CardContent>
            </Tabs>
          ) : (
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Globe className="h-12 w-12 mb-4 opacity-50" />
              <p>{t("publicChat.selectChannel")}</p>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
