/**
 * Admin page for managing Context Profiles.
 * Edit token budgets, layer configurations, and priority ordering.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useContextProfiles,
  useUpdateContextProfile,
  type ContextProfileUpdateInput,
} from "@/hooks/useContextProfiles";
import type { ContextProfileRow } from "@/lib/schemas/expertOverlaySchemas";

export default function AdminContextProfiles() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("view_admin_dashboard");

  const { data: profiles, isLoading } = useContextProfiles();
  const updateProfile = useUpdateContextProfile();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ContextProfileUpdateInput>({});

  const selectedProfile = profiles?.find((p) => p.id === selectedId);

  const handleSelect = (profile: ContextProfileRow) => {
    setSelectedId(profile.id);
    setEditForm({
      display_name: profile.display_name,
      description: profile.description,
      token_budget: profile.token_budget,
      is_active: profile.is_active,
    });
  };

  const handleSave = async () => {
    if (!selectedId) return;

    try {
      await updateProfile.mutateAsync({ id: selectedId, updates: editForm });
      toast.success("Context profile updated");
    } catch {
      toast.error("Failed to update profile");
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-8 w-8" />
          {t("admin.contextProfiles.title")}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t("admin.contextProfiles.description")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("admin.contextProfiles.list")}</CardTitle>
            <CardDescription>
              {profiles?.length ?? 0} {t("common.total")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {profiles?.map((profile) => (
              <Button
                key={profile.id}
                variant={selectedId === profile.id ? "default" : "outline"}
                className="w-full justify-between"
                onClick={() => handleSelect(profile)}
              >
                <span>{profile.slug}</span>
                {profile.is_active ? (
                  <Badge variant="default">{t("common.active")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("common.inactive")}</Badge>
                )}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {selectedProfile ? selectedProfile.display_name : t("common.selectItem")}
            </CardTitle>
            <CardDescription>
              {selectedProfile && `Slug: ${selectedProfile.slug}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedProfile ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("admin.contextProfiles.displayName")}</Label>
                  <Input
                    value={editForm.display_name ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.contextProfiles.description")}</Label>
                  <Textarea
                    value={editForm.description ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("admin.contextProfiles.tokenBudget")}</Label>
                  <Input
                    type="number"
                    value={editForm.token_budget ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, token_budget: parseInt(e.target.value) })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t("admin.contextProfiles.isActive")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("admin.contextProfiles.isActiveDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={editForm.is_active ?? false}
                    onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
                  />
                </div>

                <Button
                  onClick={handleSave}
                  className="w-full"
                  disabled={updateProfile.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateProfile.isPending ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            ) : (
              <Alert>
                <AlertDescription>{t("admin.contextProfiles.select")}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
