import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  useLeaderboardRewardConfigs,
  useUpsertLeaderboardRewardConfig,
  type LeaderboardRewardConfig,
  type UpsertLeaderboardRewardConfigInput,
} from "@/hooks/useLeaderboardRewards";
import { Loader2, Trophy, Plus, Pencil } from "lucide-react";

const PERIOD_TYPES = ["weekly", "monthly", "quarterly"] as const;

/**
 * Admin panel for configuring leaderboard rewards.
 * Allows CRUD of rank-based token + voucher rewards per period type.
 */
export function LeaderboardRewardsPanel() {
  const { t } = useTranslation();
  const { data: configs, isLoading } = useLeaderboardRewardConfigs();
  const upsertMutation = useUpsertLeaderboardRewardConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LeaderboardRewardConfig | null>(null);
  const [form, setForm] = useState<UpsertLeaderboardRewardConfigInput>({
    p_bonus_token_type: "aisha",
    p_bonus_tokens: 0,
    p_is_active: true,
    p_period_type: "weekly",
    p_rank_from: 1,
    p_rank_to: 1,
    p_voucher_product_id: undefined,
  });

  const openCreate = () => {
    setEditingConfig(null);
    setForm({
      p_bonus_token_type: "aisha",
      p_bonus_tokens: 0,
      p_is_active: true,
      p_period_type: "weekly",
      p_rank_from: 1,
      p_rank_to: 1,
      p_voucher_product_id: undefined,
    });
    setDialogOpen(true);
  };

  const openEdit = (config: LeaderboardRewardConfig) => {
    setEditingConfig(config);
    setForm({
      p_id: config.id,
      p_bonus_token_type: config.bonus_token_type,
      p_bonus_tokens: config.bonus_tokens,
      p_is_active: config.is_active,
      p_period_type: config.period_type,
      p_rank_from: config.rank_from,
      p_rank_to: config.rank_to,
      p_voucher_product_id: config.voucher_product_id || undefined,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    await upsertMutation.mutateAsync(form);
    setDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5" />
                {t("admin.leaderboardRewards.title")}
              </CardTitle>
              <CardDescription>{t("admin.leaderboardRewards.description")}</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              {t("admin.leaderboardRewards.addConfig")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.leaderboardRewards.table.period")}</TableHead>
                  <TableHead>{t("admin.leaderboardRewards.table.ranks")}</TableHead>
                  <TableHead>{t("admin.leaderboardRewards.table.tokens")}</TableHead>
                  <TableHead>{t("admin.leaderboardRewards.table.voucher")}</TableHead>
                  <TableHead>{t("admin.leaderboardRewards.table.status")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs?.map((config) => (
                  <TableRow key={config.id}>
                    <TableCell className="capitalize">{t(`admin.leaderboardRewards.periodType.${config.period_type}`)}</TableCell>
                    <TableCell>
                      {config.rank_from === config.rank_to
                        ? `#${config.rank_from}`
                        : `#${config.rank_from} - #${config.rank_to}`}
                    </TableCell>
                    <TableCell>
                      {config.bonus_tokens > 0 ? (
                        <span className="font-semibold">{config.bonus_tokens} {config.bonus_token_type}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {config.product_name ? (
                        <Badge variant="outline">{config.product_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.is_active ? "default" : "secondary"}>
                        {config.is_active ? t("common.active") : t("common.inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(config)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!configs || configs.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {t("admin.leaderboardRewards.noConfigs")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingConfig
                ? t("admin.leaderboardRewards.editTitle")
                : t("admin.leaderboardRewards.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.leaderboardRewards.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t("admin.leaderboardRewards.form.periodType")}</Label>
              <Select
                value={form.p_period_type || "weekly"}
                onValueChange={(v) => setForm({ ...form, p_period_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_TYPES.map((pt) => (
                    <SelectItem key={pt} value={pt} className="capitalize">
                      {t(`admin.leaderboardRewards.periodType.${pt}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("admin.leaderboardRewards.form.rankFrom")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.p_rank_from ?? 1}
                  onChange={(e) => setForm({ ...form, p_rank_from: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label>{t("admin.leaderboardRewards.form.rankTo")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.p_rank_to ?? 1}
                  onChange={(e) => setForm({ ...form, p_rank_to: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("admin.leaderboardRewards.form.bonusTokens")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.p_bonus_tokens ?? 0}
                  onChange={(e) => setForm({ ...form, p_bonus_tokens: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>{t("admin.leaderboardRewards.form.tokenType")}</Label>
                <Input
                  value={form.p_bonus_token_type ?? "aisha"}
                  onChange={(e) => setForm({ ...form, p_bonus_token_type: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>{t("admin.leaderboardRewards.form.voucherProductId")}</Label>
              <Input
                value={form.p_voucher_product_id ?? ""}
                onChange={(e) => setForm({ ...form, p_voucher_product_id: e.target.value || undefined })}
                placeholder={t("admin.leaderboardRewards.form.voucherPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.p_is_active ?? true}
                onCheckedChange={(v) => setForm({ ...form, p_is_active: v })}
              />
              <Label>{t("common.active")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleSave}
              disabled={upsertMutation.isPending}
            >
              {upsertMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
