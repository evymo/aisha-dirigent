import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useTokenConfigs, useTokenAllocations, useCreateTokenAllocation } from "@/hooks/useTokenomics";
import { Plus, Loader2 } from "lucide-react";

export function AllocationsPanel() {
    const { t } = useTranslation();
    const { data: tokenConfigs } = useTokenConfigs();
    const { data: allocations } = useTokenAllocations();
    const createAllocation = useCreateTokenAllocation();
    const [newAllocationOpen, setNewAllocationOpen] = useState(false);

    const [newAlloc, setNewAlloc] = useState({
        allocation_name: "",
        allocation_type: "community",
        token_type: "aisha",
        total_amount: 0,
        vesting_schedule: "immediate",
    });

    const handleCreateAllocation = () => {
        createAllocation.mutate(newAlloc);
        setNewAllocationOpen(false);
        setNewAlloc({ allocation_name: "", allocation_type: "community", token_type: "aisha", total_amount: 0, vesting_schedule: "immediate" });
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">{t("admin.tokenomics.allocations")}</h2>
                <Dialog open={newAllocationOpen} onOpenChange={setNewAllocationOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            {t("admin.tokenomics.addAllocation")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("admin.tokenomics.newAllocation")}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>{t("admin.tokenomics.allocationName")}</Label>
                                <Input
                                    value={newAlloc.allocation_name}
                                    onChange={(e) => setNewAlloc({ ...newAlloc, allocation_name: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.allocationType")}</Label>
                                    <Select
                                        value={newAlloc.allocation_type}
                                        onValueChange={(v) => setNewAlloc({ ...newAlloc, allocation_type: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="team">{t("admin.tokenomics.allocationTypes.team")}</SelectItem>
                                            <SelectItem value="community">{t("admin.tokenomics.allocationTypes.community")}</SelectItem>
                                            <SelectItem value="treasury">{t("admin.tokenomics.allocationTypes.treasury")}</SelectItem>
                                            <SelectItem value="partners">{t("admin.tokenomics.allocationTypes.partners")}</SelectItem>
                                            <SelectItem value="airdrop">{t("admin.tokenomics.allocationTypes.airdrop")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.tokenType")}</Label>
                                    <Select
                                        value={newAlloc.token_type}
                                        onValueChange={(v) => setNewAlloc({ ...newAlloc, token_type: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {tokenConfigs?.map((c) => (
                                                <SelectItem key={c.token_type} value={c.token_type}>
                                                    {c.symbol}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.totalAmount")}</Label>
                                    <Input
                                        type="number"
                                        value={newAlloc.total_amount}
                                        onChange={(e) => setNewAlloc({ ...newAlloc, total_amount: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.vestingSchedule")}</Label>
                                    <Select
                                        value={newAlloc.vesting_schedule}
                                        onValueChange={(v) => setNewAlloc({ ...newAlloc, vesting_schedule: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="immediate">{t("admin.tokenomics.vestingOptions.immediate")}</SelectItem>
                                            <SelectItem value="linear">{t("admin.tokenomics.vestingOptions.linear")}</SelectItem>
                                            <SelectItem value="cliff">{t("admin.tokenomics.vestingOptions.cliff")}</SelectItem>
                                            <SelectItem value="custom">{t("admin.tokenomics.vestingOptions.custom")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setNewAllocationOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button onClick={handleCreateAllocation} disabled={createAllocation.isPending}>
                                {createAllocation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {t("common.save")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                {allocations?.map((alloc) => {
                    const progress = alloc.total_amount > 0
                        ? (alloc.distributed_amount / alloc.total_amount) * 100
                        : 0;
                    return (
                        <Card key={alloc.id}>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg">{alloc.allocation_name}</CardTitle>
                                    <Badge variant="outline">
                                        {t(`admin.tokenomics.allocationTypes.${alloc.allocation_type}`)}
                                    </Badge>
                                </div>
                                <CardDescription>
                                    {alloc.token_type.toUpperCase()} • {alloc.vesting_schedule}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span>{t("admin.tokenomics.distributed")}</span>
                                            <span>{progress.toFixed(1)}%</span>
                                        </div>
                                        <Progress value={progress} className="h-2" />
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">
                                            {alloc.distributed_amount.toLocaleString()} / {alloc.total_amount.toLocaleString()}
                                        </span>
                                        <Badge variant={alloc.is_active ? "default" : "secondary"}>
                                            {alloc.is_active ? t("common.active") : t("common.inactive")}
                                        </Badge>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
