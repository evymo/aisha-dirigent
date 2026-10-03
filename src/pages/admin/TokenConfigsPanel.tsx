import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTokenConfigs, useUpdateTokenConfig, type TokenConfig } from "@/hooks/useTokenomics";
import { Edit, Loader2, Coins } from "lucide-react";
import { TOKEN_ICONS, TOKEN_COLORS } from "./tokenomics-constants";

export function TokenConfigsPanel() {
    const { t } = useTranslation();
    const { data: tokenConfigs } = useTokenConfigs();
    const updateConfig = useUpdateTokenConfig();
    const [editingConfig, setEditingConfig] = useState<TokenConfig | null>(null);

    const handleSaveConfig = () => {
        if (editingConfig) {
            updateConfig.mutate({ id: editingConfig.id, updates: editingConfig });
            setEditingConfig(null);
        }
    };

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("admin.tokenomics.tokenConfiguration")}</h2>

            <div className="grid md:grid-cols-2 gap-4">
                {tokenConfigs?.map((config) => {
                    const Icon = TOKEN_ICONS[config.token_type] || Coins;
                    return (
                        <Card key={config.id}>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Icon className={`w-5 h-5 ${TOKEN_COLORS[config.token_type]}`} />
                                        <CardTitle>{config.name}</CardTitle>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setEditingConfig(config)}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                </div>
                                <CardDescription>{config.symbol} • {config.token_type}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">{config.description}</p>
                                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                                    <div>
                                        <span className="text-muted-foreground">{t("admin.tokenomics.totalSupply")}:</span>
                                        <span className="ml-2 font-medium">{config.total_supply.toLocaleString()}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">{t("admin.tokenomics.emission")}:</span>
                                        <span className="ml-2 font-medium">
                                            {config.emission_rate_daily?.toLocaleString() || 0}
                                            {t("admin.tokenomics.units.perDay")}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Edit Config Dialog */}
            <Dialog open={!!editingConfig} onOpenChange={(open) => !open && setEditingConfig(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("admin.tokenomics.editToken")}</DialogTitle>
                    </DialogHeader>
                    {editingConfig && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.name")}</Label>
                                    <Input
                                        value={editingConfig.name}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.symbol")}</Label>
                                    <Input
                                        value={editingConfig.symbol}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, symbol: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>{t("admin.tokenomics.description")}</Label>
                                <Textarea
                                    value={editingConfig.description || ""}
                                    onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.totalSupply")}</Label>
                                    <Input
                                        type="number"
                                        value={editingConfig.total_supply}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, total_supply: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.dailyEmission")}</Label>
                                    <Input
                                        type="number"
                                        value={editingConfig.emission_rate_daily || 0}
                                        onChange={(e) => setEditingConfig({ ...editingConfig, emission_rate_daily: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={editingConfig.is_active}
                                    onCheckedChange={(checked) => setEditingConfig({ ...editingConfig, is_active: checked })}
                                />
                                <Label>{t("common.active")}</Label>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingConfig(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleSaveConfig} disabled={updateConfig.isPending}>
                            {updateConfig.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {t("common.save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
