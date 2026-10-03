/**
 * Admin page for managing MCP authentication tokens.
 * Create, activate/deactivate, and revoke tokens for MCP server access.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Key, Plus, Copy, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useMcpTokens,
  useCreateMcpToken,
  useToggleMcpToken,
  useRevokeMcpToken,
} from "@/hooks/useMcpTokens";

export default function AdminMcpTokens() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const { data: tokens, isLoading } = useMcpTokens();
  const createToken = useCreateMcpToken();
  const toggleToken = useToggleMcpToken();
  const revokeToken = useRevokeMcpToken();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [newTokenHash, setNewTokenHash] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<{
    description: string;
    scope: "full" | "read_only" | "tool_specific";
    allowed_tools: string;
    rate_limit_per_hour: number;
  }>({
    description: "",
    scope: "full",
    allowed_tools: "[]",
    rate_limit_per_hour: 100,
  });

  const handleCreate = async () => {
    try {
      const result = await createToken.mutateAsync({
        scope: createForm.scope,
        allowed_tools: JSON.parse(createForm.allowed_tools) as string[],
        rate_limit_rpm: createForm.rate_limit_per_hour,
      });
      setNewTokenHash(result.token_hash);
      setShowCreateDialog(false);
      setShowTokenDialog(true);
      toast.success("Token created");
    } catch {
      toast.error("Failed to create token");
    }
  };

  const handleCopyToken = () => {
    if (newTokenHash) {
      navigator.clipboard.writeText(newTokenHash);
      toast.success("Token copied to clipboard");
    }
  };

  const handleToggle = async (id: string, currentState: boolean) => {
    try {
      await toggleToken.mutateAsync({ id, isActive: !currentState });
      toast.success(currentState ? "Token deactivated" : "Token activated");
    } catch {
      toast.error("Failed to toggle token");
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Permanently revoke this token?")) return;
    try {
      await revokeToken.mutateAsync(id);
      toast.success("Token revoked");
    } catch {
      toast.error("Failed to revoke token");
    }
  };

  if (!canManage) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Key className="h-8 w-8" />
            {t("admin.mcpTokens.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("admin.mcpTokens.description")}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("admin.mcpTokens.create")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.mcpTokens.list")}</CardTitle>
          <CardDescription>
            {tokens?.length ?? 0} {t("common.total")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tokens?.map((token) => (
              <div key={token.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={token.is_active ? "default" : "secondary"}>{token.scope}</Badge>
                    <span className="text-sm">{t("admin.mcpTokens.noDescription")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={token.is_active}
                      onCheckedChange={() => handleToggle(token.id, token.is_active)}
                      disabled={toggleToken.isPending}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRevoke(token.id)}
                      disabled={revokeToken.isPending}
                    >
                      {t("common.revoke")}
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
                  <div>{t("admin.mcpTokens.rateLimitValue", { value: token.rate_limit_rpm })}</div>
                  <div>{t("admin.mcpTokens.usageValue", { value: token.usage_count })}</div>
                  <div>{t("admin.mcpTokens.createdValue", { value: new Date(token.created_at).toLocaleDateString() })}</div>
                  <div>{t("admin.mcpTokens.lastUsedValue", { value: token.last_used_at ? new Date(token.last_used_at).toLocaleString() : t("common.never") })}</div>
                </div>
              </div>
            ))}

            {!tokens || tokens.length === 0 && (
              <Alert>
                <AlertDescription>{t("admin.mcpTokens.empty")}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.mcpTokens.createNew")}</DialogTitle>
            <DialogDescription>
              {t("admin.mcpTokens.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.mcpTokens.description")}</Label>
              <Input
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder={t("admin.mcpTokens.placeholderDescription")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.mcpTokens.scope")}</Label>
              <select
                className="w-full border rounded p-2 bg-background"
                value={createForm.scope}
                onChange={(e) => setCreateForm({ ...createForm, scope: e.target.value as "full" | "read_only" | "tool_specific" })}
              >
                <option value="full">{t("admin.mcpTokens.scopeFull")}</option>
                <option value="read_only">{t("admin.mcpTokens.scopeReadOnly")}</option>
                <option value="tool_specific">{t("admin.mcpTokens.scopeToolSpecific")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.mcpTokens.rateLimit")}</Label>
              <Input
                type="number"
                value={createForm.rate_limit_per_hour}
                onChange={(e) => setCreateForm({ ...createForm, rate_limit_per_hour: parseInt(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={createToken.isPending}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("admin.mcpTokens.tokenCreated")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.mcpTokens.copyWarning")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded font-mono text-sm break-all">
              {newTokenHash}
            </div>
            <Button onClick={handleCopyToken} className="w-full">
              <Copy className="h-4 w-4 mr-2" />
              {t("common.copy")}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => { setShowTokenDialog(false); setNewTokenHash(null); }}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
