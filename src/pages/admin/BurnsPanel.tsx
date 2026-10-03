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
import { useTokenConfigs, useTokenBurns, useCreateTokenBurn } from "@/hooks/useTokenomics";
import { useSession } from "@/hooks/useSession";
import { Flame, Loader2, AlertTriangle } from "lucide-react";

export function BurnsPanel() {
    const { t } = useTranslation();
    const { user } = useSession();
    const { data: tokenConfigs } = useTokenConfigs();
    const { data: tokenBurns } = useTokenBurns();
    const createBurn = useCreateTokenBurn();
    const [newBurnOpen, setNewBurnOpen] = useState(false);

    const [newBurn, setNewBurn] = useState({
        token_type: "aisha",
        amount: 0,
        burn_reason: "manual",
        description: "",
    });

    const handleCreateBurn = () => {
        createBurn.mutate({
            ...newBurn,
            burned_by: user?.id,
        });
        setNewBurnOpen(false);
        setNewBurn({ token_type: "aisha", amount: 0, burn_reason: "manual", description: "" });
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">{t("admin.tokenomics.burnHistory")}</h2>
                <Dialog open={newBurnOpen} onOpenChange={setNewBurnOpen}>
                    <DialogTrigger asChild>
                        <Button variant="destructive">
                            <Flame className="w-4 h-4 mr-2" />
                            {t("admin.tokenomics.burnTokens")}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-destructive" />
                                {t("admin.tokenomics.burnTokens")}
                            </DialogTitle>
                            <DialogDescription>
                                {t("admin.tokenomics.burnWarning")}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("admin.tokenomics.tokenType")}</Label>
                                    <Select
                                        value={newBurn.token_type}
                                        onValueChange={(v) => setNewBurn({ ...newBurn, token_type: v })}
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
                                        value={newBurn.amount}
                                        onChange={(e) => setNewBurn({ ...newBurn, amount: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>{t("admin.tokenomics.burnReason")}</Label>
                                <Select
                                    value={newBurn.burn_reason}
                                    onValueChange={(v) => setNewBurn({ ...newBurn, burn_reason: v })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="membership_payment">{t("admin.tokenomics.burnReasons.membershipPayment")}</SelectItem>
                                        <SelectItem value="penalty">{t("admin.tokenomics.burnReasons.penalty")}</SelectItem>
                                        <SelectItem value="scheduled">{t("admin.tokenomics.burnReasons.scheduled")}</SelectItem>
                                        <SelectItem value="manual">{t("admin.tokenomics.burnReasons.manual")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>{t("admin.tokenomics.description")}</Label>
                                <Textarea
                                    value={newBurn.description}
                                    onChange={(e) => setNewBurn({ ...newBurn, description: e.target.value })}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setNewBurnOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button variant="destructive" onClick={handleCreateBurn} disabled={createBurn.isPending}>
                                {createBurn.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {t("admin.tokenomics.confirmBurn")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("admin.tokenomics.date")}</TableHead>
                            <TableHead>{t("admin.tokenomics.token")}</TableHead>
                            <TableHead>{t("admin.tokenomics.amount")}</TableHead>
                            <TableHead>{t("admin.tokenomics.reason")}</TableHead>
                            <TableHead>{t("admin.tokenomics.description")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tokenBurns?.map((burn) => (
                            <TableRow key={burn.id}>
                                <TableCell>{new Date(burn.created_at).toLocaleString()}</TableCell>
                                <TableCell>
                                    <Badge variant="outline">{burn.token_type}</Badge>
                                </TableCell>
                                <TableCell className="font-semibold text-destructive">
                                    -{burn.amount.toLocaleString()}
                                </TableCell>
                                <TableCell>{burn.burn_reason}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    {burn.description || "-"}
                                </TableCell>
                            </TableRow>
                        ))}
                        {(!tokenBurns || tokenBurns.length === 0) && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    {t("admin.tokenomics.noBurns")}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>
        </div>
    );
}
