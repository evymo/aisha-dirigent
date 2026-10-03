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
    useTokenConfigs,
    useTokenRewardRules,
    useUpdateRewardRule,
    useCreateRewardRule,
    type TokenRewardRule,
} from "@/hooks/useTokenomics";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { Plus, Edit, Loader2, Coins } from "lucide-react";
import { TOKEN_ICONS, TOKEN_COLORS } from "./tokenomics-constants";
import {
    ACTIVITY_TEMPLATES,
    groupedTemplates,
    categorizeRules,
    getCategoryIcon,
    getCategoryLabel,
    getCategoryDescription,
} from "./templates";

export function RewardRulesPanel() {
    const { t } = useTranslation();

    const { data: tokenConfigs } = useTokenConfigs();
    const { data: rewardRules } = useTokenRewardRules();
    const updateRule = useUpdateRewardRule();
    const createRule = useCreateRewardRule();

    const [editingRule, setEditingRule] = useState<TokenRewardRule | null>(null);
    const [newRuleOpen, setNewRuleOpen] = useState(false);

    const [newRule, setNewRule] = useState<Partial<TokenRewardRule>>({
        action_type: "",
        token_type: "data",
        base_amount: 0,
        multiplier: 1,
        is_active: true,
    });

    // Resolve translation keys for display
    const allActionNameKeys = (rewardRules ?? []).map(r => r.action_name_key).filter(Boolean);
    const allDescriptionKeys = (rewardRules ?? []).map(r => r.description_key).filter((k): k is string => Boolean(k));
    const translationsMap = useDynamicTranslationsMap([...allActionNameKeys, ...allDescriptionKeys], "tokenomics", "en");

    const handleSaveRule = () => {
        if (editingRule) {
            updateRule.mutate({ id: editingRule.id, updates: editingRule });
            setEditingRule(null);
        }
    };

    const handleCreateRule = () => {
        createRule.mutate(newRule);
        setNewRuleOpen(false);
        setNewRule({
            action_type: "",
            token_type: "data",
            base_amount: 0,
            multiplier: 1,
            is_active: true,
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold">{t("admin.tokenomics.rewardRules")}</h2>
                    <p className="text-sm text-muted-foreground">
                        {t("admin.tokenomics.rewardsDescription")}
                    </p>
                </div>
                <Dialog open={newRuleOpen} onOpenChange={setNewRuleOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            {t("admin.tokenomics.addRule")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{t("admin.tokenomics.newRewardRule")}</DialogTitle>
                            <DialogDescription>
                                {t("admin.tokenomics.newRuleDescription")}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            <div>
                                <Label>{t("admin.tokenomics.actionType")}</Label>
                                <Select
                                    value={newRule.action_type || "custom"}
                                    onValueChange={(v) => {
                                        const template = ACTIVITY_TEMPLATES.find(t => t.action_type === v);
                                        if (template) {
                                            setNewRule({
                                                ...newRule,
                                                ...template,
                                            });
                                        } else {
                                            setNewRule({ ...newRule, action_type: v });
                                        }
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t("admin.tokenomics.selectActivityType")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(groupedTemplates).map(([category, templates]) => (
                                            <div key={category}>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                                    {category}
                                                </div>
                                                {templates.map((template) => (
                                                    <SelectItem key={template.action_type} value={template.action_type}>
                                                        {t(`admin.tokenomics.templates.${template.action_type}`)}
                                                    </SelectItem>
                                                ))}
                                            </div>
                                        ))}
                                        <SelectItem value="custom">{t("admin.tokenomics.customActivity")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {newRule.action_type === "custom" && (
                                <div>
                                    <Label>{t("admin.tokenomics.customActionType")}</Label>
                                    <Input
                                        value={newRule.action_type === "custom" ? "" : newRule.action_type || ""}
                                        onChange={(e) => setNewRule({ ...newRule, action_type: e.target.value })}
                                        placeholder={t("admin.tokenomics.placeholders.actionTypeExample")}
                                    />
                                </div>
                            )}

                            <p className="text-xs text-muted-foreground">
                                {t("admin.tokenomics.translationsNote")}
                            </p>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.tokenType")}</Label>
                                    <Select
                                        value={newRule.token_type}
                                        onValueChange={(v) => setNewRule({ ...newRule, token_type: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {tokenConfigs?.map((c) => (
                                                <SelectItem key={c.token_type} value={c.token_type}>
                                                    <div className="flex items-center gap-2">
                                                        {(() => {
                                                            const Icon = TOKEN_ICONS[c.token_type] || Coins;
                                                            return <Icon className={`w-4 h-4 ${TOKEN_COLORS[c.token_type]}`} />;
                                                        })()}
                                                        {c.symbol} - {c.name}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.baseAmount")}</Label>
                                    <Input
                                        type="number"
                                        value={newRule.base_amount || 0}
                                        onChange={(e) => setNewRule({ ...newRule, base_amount: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.multiplier")}</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={newRule.multiplier || 1}
                                        onChange={(e) => setNewRule({ ...newRule, multiplier: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.dailyLimit")}</Label>
                                    <Input
                                        type="number"
                                        value={newRule.daily_limit || ""}
                                        onChange={(e) => setNewRule({ ...newRule, daily_limit: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.weeklyLimit")}</Label>
                                    <Input
                                        type="number"
                                        value={newRule.weekly_limit || ""}
                                        onChange={(e) => setNewRule({ ...newRule, weekly_limit: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.cooldown")}</Label>
                                    <Input
                                        type="number"
                                        value={newRule.cooldown_hours || ""}
                                        onChange={(e) => setNewRule({ ...newRule, cooldown_hours: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noHours")}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={newRule.is_active}
                                        onCheckedChange={(checked) => setNewRule({ ...newRule, is_active: checked })}
                                    />
                                    <Label>{t("common.active")}</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={newRule.requires_membership || false}
                                        onCheckedChange={(checked) => setNewRule({ ...newRule, requires_membership: checked })}
                                    />
                                    <Label>{t("admin.tokenomics.requiresMembership")}</Label>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setNewRuleOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button onClick={handleCreateRule} disabled={createRule.isPending}>
                                {createRule.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {t("common.save")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Rewards by Category */}
            {Object.entries(categorizeRules(rewardRules || [])).map(([category, rules]) => (
                <Card key={category}>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            {getCategoryIcon(category)}
                            <CardTitle className="text-base">{getCategoryLabel(category, t)}</CardTitle>
                            <Badge variant="secondary" className="ml-auto">
                                {rules.length} {rules.length === 1 ? "rule" : "rules"}
                            </Badge>
                        </div>
                        <CardDescription>{getCategoryDescription(category, t)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[300px]">{t("admin.tokenomics.action")}</TableHead>
                                    <TableHead>{t("admin.tokenomics.token")}</TableHead>
                                    <TableHead className="text-right">{t("admin.tokenomics.reward")}</TableHead>
                                    <TableHead>{t("admin.tokenomics.limits")}</TableHead>
                                    <TableHead>{t("common.status")}</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rules.map((rule) => {
                                    const Icon = TOKEN_ICONS[rule.token_type] || Coins;
                                    return (
                                        <TableRow key={rule.id}>
                                            <TableCell>
                                                <div>
                                                    <p className="font-medium">
                                                        {translationsMap[rule.action_name_key] ?? rule.action_type}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {rule.description_key ? (translationsMap[rule.description_key] ?? rule.description_key) : ""}
                                                    </p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="gap-1">
                                                    <Icon className={`w-3 h-3 ${TOKEN_COLORS[rule.token_type]}`} />
                                                    {rule.token_type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className="font-semibold">
                                                    {rule.base_amount * rule.multiplier}
                                                </span>
                                                {rule.multiplier !== 1 && (
                                                    <span className="text-xs text-muted-foreground ml-1">
                                                        {t("admin.tokenomics.rewardMultiplierDetail", {
                                                            base: rule.base_amount,
                                                            multiplier: rule.multiplier,
                                                        })}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-xs space-y-0.5">
                                                    {rule.daily_limit && (
                                                        <p>{t("admin.tokenomics.limitsText.daily", { limit: rule.daily_limit })}</p>
                                                    )}
                                                    {rule.weekly_limit && (
                                                        <p>{t("admin.tokenomics.limitsText.weekly", { limit: rule.weekly_limit })}</p>
                                                    )}
                                                    {rule.monthly_limit && (
                                                        <p>{t("admin.tokenomics.limitsText.monthly", { limit: rule.monthly_limit })}</p>
                                                    )}
                                                    {rule.cooldown_hours && rule.cooldown_hours > 0 && (
                                                        <p>
                                                            {t("admin.tokenomics.limitsText.cooldown", {
                                                                hours: rule.cooldown_hours,
                                                            })}
                                                        </p>
                                                    )}
                                                    {!rule.daily_limit && !rule.weekly_limit && !rule.monthly_limit && !rule.cooldown_hours && (
                                                        <span className="text-muted-foreground">{t("admin.tokenomics.limitsText.none")}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={rule.is_active ? "default" : "secondary"}>
                                                    {rule.is_active ? t("common.active") : t("common.inactive")}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setEditingRule(rule)}
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            ))}

            {/* Edit Rule Dialog */}
            <Dialog open={!!editingRule} onOpenChange={(open) => !open && setEditingRule(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{t("admin.tokenomics.editRule")}</DialogTitle>
                        <DialogDescription>
                            {editingRule?.action_type}
                        </DialogDescription>
                    </DialogHeader>
                    {editingRule && (
                        <div className="space-y-4">
                            <div>
                                <Label>{t("admin.tokenomics.actionName")}</Label>
                                <p className="text-sm font-medium">
                                    {translationsMap[editingRule.action_name_key] ?? editingRule.action_type}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("admin.tokenomics.translationsNote")}
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.tokenType")}</Label>
                                    <Select
                                        value={editingRule.token_type}
                                        onValueChange={(v) => setEditingRule({ ...editingRule, token_type: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {tokenConfigs?.map((c) => (
                                                <SelectItem key={c.token_type} value={c.token_type}>
                                                    <div className="flex items-center gap-2">
                                                        {(() => {
                                                            const Icon = TOKEN_ICONS[c.token_type] || Coins;
                                                            return <Icon className={`w-4 h-4 ${TOKEN_COLORS[c.token_type]}`} />;
                                                        })()}
                                                        {c.symbol}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.baseAmount")}</Label>
                                    <Input
                                        type="number"
                                        value={editingRule.base_amount}
                                        onChange={(e) => setEditingRule({ ...editingRule, base_amount: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.multiplier")}</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={editingRule.multiplier}
                                        onChange={(e) => setEditingRule({ ...editingRule, multiplier: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div className="p-3 bg-muted/50 rounded-lg">
                                <p className="text-sm text-muted-foreground mb-1">{t("admin.tokenomics.effectiveReward")}</p>
                                <p className="text-2xl font-bold">
                                    {editingRule.base_amount * editingRule.multiplier} {editingRule.token_type}
                                </p>
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.dailyLimit")}</Label>
                                    <Input
                                        type="number"
                                        value={editingRule.daily_limit || ""}
                                        onChange={(e) => setEditingRule({ ...editingRule, daily_limit: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.weeklyLimit")}</Label>
                                    <Input
                                        type="number"
                                        value={editingRule.weekly_limit || ""}
                                        onChange={(e) => setEditingRule({ ...editingRule, weekly_limit: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.monthlyLimit")}</Label>
                                    <Input
                                        type="number"
                                        value={editingRule.monthly_limit || ""}
                                        onChange={(e) => setEditingRule({ ...editingRule, monthly_limit: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.cooldown")}</Label>
                                    <Input
                                        type="number"
                                        value={editingRule.cooldown_hours || ""}
                                        onChange={(e) => setEditingRule({ ...editingRule, cooldown_hours: e.target.value ? Number(e.target.value) : null })}
                                        placeholder={t("admin.tokenomics.noHours")}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-6 pt-2">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={editingRule.is_active}
                                        onCheckedChange={(checked) => setEditingRule({ ...editingRule, is_active: checked })}
                                    />
                                    <Label>{t("common.active")}</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={editingRule.requires_membership || false}
                                        onCheckedChange={(checked) => setEditingRule({ ...editingRule, requires_membership: checked })}
                                    />
                                    <Label>{t("admin.tokenomics.requiresMembership")}</Label>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingRule(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleSaveRule} disabled={updateRule.isPending}>
                            {updateRule.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {t("common.save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
