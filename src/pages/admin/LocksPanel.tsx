import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTokenConfigs, useTokenLocks, useCreateTokenLock } from "@/hooks/useTokenomics";
import { Plus, Loader2, ArrowRight } from "lucide-react";

export function LocksPanel() {
    const { t } = useTranslation();
    const { data: tokenConfigs } = useTokenConfigs();
    const { data: tokenLocks } = useTokenLocks();
    const createLock = useCreateTokenLock();
    const [newLockOpen, setNewLockOpen] = useState(false);

    const [newLock, setNewLock] = useState({
        user_id: "",
        token_type: "governance",
        amount: 0,
        lock_reason: "manual",
        lock_end: "",
        notes: "",
    });

    const handleCreateLock = () => {
        createLock.mutate({
            ...newLock,
            lock_start: new Date().toISOString(),
            lock_end: new Date(newLock.lock_end).toISOString(),
        });
        setNewLockOpen(false);
        setNewLock({ user_id: "", token_type: "governance", amount: 0, lock_reason: "manual", lock_end: "", notes: "" });
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">{t("admin.tokenomics.tokenLocks")}</h2>
                <Dialog open={newLockOpen} onOpenChange={setNewLockOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            {t("admin.tokenomics.createLock")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("admin.tokenomics.newLock")}</DialogTitle>
                            <DialogDescription>
                                {t("admin.tokenomics.lockDescription")}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>{t("admin.tokenomics.userId")}</Label>
                                <Input
                                    value={newLock.user_id}
                                    onChange={(e) => setNewLock({ ...newLock, user_id: e.target.value })}
                                    placeholder={t("admin.tokenomics.placeholders.userId")}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.tokenType")}</Label>
                                    <Select
                                        value={newLock.token_type}
                                        onValueChange={(v) => setNewLock({ ...newLock, token_type: v })}
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
                                <div>
                                    <Label>{t("admin.tokenomics.amount")}</Label>
                                    <Input
                                        type="number"
                                        value={newLock.amount}
                                        onChange={(e) => setNewLock({ ...newLock, amount: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.lockReason")}</Label>
                                    <Select
                                        value={newLock.lock_reason}
                                        onValueChange={(v) => setNewLock({ ...newLock, lock_reason: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="vesting">{t("admin.tokenomics.lockReasons.vesting")}</SelectItem>
                                            <SelectItem value="staking">{t("admin.tokenomics.lockReasons.staking")}</SelectItem>
                                            <SelectItem value="penalty">{t("admin.tokenomics.lockReasons.penalty")}</SelectItem>
                                            <SelectItem value="manual">{t("admin.tokenomics.lockReasons.manual")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>{t("admin.tokenomics.lockEnd")}</Label>
                                    <Input
                                        type="datetime-local"
                                        value={newLock.lock_end}
                                        onChange={(e) => setNewLock({ ...newLock, lock_end: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>{t("admin.tokenomics.notes")}</Label>
                                <Textarea
                                    value={newLock.notes}
                                    onChange={(e) => setNewLock({ ...newLock, notes: e.target.value })}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setNewLockOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button onClick={handleCreateLock} disabled={createLock.isPending}>
                                {createLock.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {t("admin.tokenomics.createLock")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.tokenomics.user")}</TableHead>
                            <TableHead>{t("admin.tokenomics.token")}</TableHead>
                            <TableHead>{t("admin.tokenomics.amount")}</TableHead>
                            <TableHead>{t("admin.tokenomics.reason")}</TableHead>
                            <TableHead>{t("admin.tokenomics.lockPeriod")}</TableHead>
                            <TableHead>{t("common.status")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tokenLocks?.map((lock) => (
                            <TableRow key={lock.id}>
                                <TableCell>
                                    <div>
                                        <p className="font-medium">{lock.profile?.display_name || lock.profile?.email || "Unknown"}</p>
                                        <p className="text-xs text-muted-foreground">{lock.user_id.slice(0, 8)}...</p>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline">{lock.token_type}</Badge>
                                </TableCell>
                                <TableCell className="font-semibold">{lock.amount.toLocaleString()}</TableCell>
                                <TableCell>{lock.lock_reason}</TableCell>
                                <TableCell>
                                    <div className="text-sm">
                                        <p>{new Date(lock.lock_start).toLocaleDateString()}</p>
                                        <p className="text-muted-foreground"><ArrowRight className="inline h-3 w-3 mr-1" />{new Date(lock.lock_end).toLocaleDateString()}</p>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={lock.is_active ? "default" : "secondary"}>
                                        {lock.is_active ? t("admin.tokenomics.locked") : t("admin.tokenomics.unlocked")}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        ))}
                        {(!tokenLocks || tokenLocks.length === 0) && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    {t("admin.tokenomics.noLocks")}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>
        </div>
    );
}
